import { leads } from '@leadora/database';
import { eq, ilike, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import { escapeLike } from './normalize';

/** The lead-list filters, shared by the list API and exports so an export always matches what was on screen. */
export interface LeadFilterQuery {
  q?: string;
  owner?: string;
  stageId?: string;
  sourceId?: string;
  tag?: string;
  priority?: string;
  temperature?: string;
  archived?: 'true' | 'false';
  /**
   * Set by the server, never from user input: limits results to this user's own and unassigned leads. Stored
   * with background jobs (exports) so they apply the visibility the requester had.
   */
  visibleTo?: string;
}

/** Who is looking at leads. Without lead.view_all a viewer sees only their own and unassigned leads. */
export interface LeadViewer {
  userId: string;
  permissions: ReadonlySet<string>;
}

/** The visibility condition for a viewer, or undefined when they may see every lead in the organization. */
export function leadVisibility(viewer: LeadViewer): SQL | undefined {
  return viewer.permissions.has('lead.view_all') ? undefined : ownOrUnassigned(viewer.userId);
}

/** The filter fields that record a viewer's visibility, for jobs that run later on their behalf. */
export function visibilityFilter(viewer: LeadViewer): Pick<LeadFilterQuery, 'visibleTo'> {
  return viewer.permissions.has('lead.view_all') ? {} : { visibleTo: viewer.userId };
}

const ownOrUnassigned = (userId: string) => or(eq(leads.ownerUserId, userId), isNull(leads.ownerUserId))!;

export function leadFilters(q: LeadFilterQuery, viewerUserId: string): SQL[] {
  const filters: SQL[] = [q.archived === 'true' ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt)];
  if (q.visibleTo) filters.push(ownOrUnassigned(q.visibleTo));
  if (q.owner === 'me') filters.push(eq(leads.ownerUserId, viewerUserId));
  else if (q.owner === 'unassigned') filters.push(isNull(leads.ownerUserId));
  else if (q.owner) filters.push(eq(leads.ownerUserId, q.owner));
  if (q.stageId) filters.push(eq(leads.stageId, q.stageId));
  if (q.sourceId) filters.push(eq(leads.sourceId, q.sourceId));
  if (q.priority) filters.push(eq(leads.priority, q.priority as 'LOW'));
  if (q.temperature) filters.push(eq(leads.temperature, q.temperature as 'HOT'));
  if (q.tag) {
    filters.push(sql`exists (select 1 from lead_tag_links tl join lead_tags t on t.id = tl.tag_id where tl.lead_id = ${leads.id} and t.name = ${q.tag})`);
  }
  if (q.q) {
    const pattern = `%${escapeLike(q.q)}%`;
    filters.push(or(ilike(leads.fullName, pattern), ilike(leads.email, pattern), ilike(leads.phone, pattern), ilike(leads.companyName, pattern))!);
  }
  return filters;
}
