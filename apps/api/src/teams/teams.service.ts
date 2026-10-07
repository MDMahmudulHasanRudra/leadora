import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type DbHandle, teamMembers, teams, type Transaction, users } from '@leadora/database';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { isUniqueViolation } from '../common/db-errors';
import type { RequestMeta } from '../common/request-meta';
import { DB } from '../infra/tokens';
import type { CreateTeamInput, UpdateTeamInput } from './teams.schemas';

type Db = DbHandle['db'] | Transaction;

const teamNotFound = () => new NotFoundException({ code: 'TEAM_NOT_FOUND', message: 'Team not found' });
const nameTaken = () => new ConflictException({ code: 'TEAM_NAME_TAKEN', message: 'A team with this name already exists' });

@Injectable()
export class TeamsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, db: Db = this.handle.db, teamIds?: string[]) {
    const scope = eq(teams.organizationId, organizationId);
    const rows = await db
      .select({ id: teams.id, name: teams.name, description: teams.description, createdAt: teams.createdAt })
      .from(teams)
      .where(teamIds ? and(scope, inArray(teams.id, teamIds)) : scope)
      .orderBy(asc(teams.name));
    if (!rows.length) return [];

    const members = await db
      .select({ teamId: teamMembers.teamId, id: users.id, fullName: users.fullName })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(inArray(teamMembers.teamId, rows.map((r) => r.id)))
      .orderBy(asc(users.fullName));

    return rows.map((team) => ({
      ...team,
      members: members.filter((m) => m.teamId === team.id).map(({ id, fullName }) => ({ id, fullName })),
    }));
  }

  private async get(organizationId: string, id: string, db: Db) {
    const [team] = await this.list(organizationId, db, [id]);
    if (!team) throw teamNotFound();
    return team;
  }

  private async lockTeam(tx: Transaction, organizationId: string, id: string) {
    const [row] = await tx
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.organizationId, organizationId)))
      .for('update');
    if (!row) throw teamNotFound();
    return row;
  }

  async create(auth: AuthContext, input: CreateTeamInput, meta: RequestMeta) {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [team] = await tx
          .insert(teams)
          .values({ organizationId: auth.organizationId, name: input.name, description: input.description ?? null })
          .returning();
        await this.audit.record(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'team.created',
          resourceType: 'team',
          resourceId: team!.id,
          newValues: { name: team!.name, description: team!.description },
          meta,
        });
        return this.get(auth.organizationId, team!.id, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'teams_organization_id_name_unique')) throw nameTaken();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateTeamInput, meta: RequestMeta) {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const current = await this.lockTeam(tx, auth.organizationId, id);
        await tx.update(teams).set(input).where(eq(teams.id, id));
        await this.audit.record(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'team.updated',
          resourceType: 'team',
          resourceId: id,
          oldValues: Object.fromEntries(Object.keys(input).map((k) => [k, current[k as keyof typeof input]])),
          newValues: input,
          meta,
        });
        return this.get(auth.organizationId, id, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'teams_organization_id_name_unique')) throw nameTaken();
      throw err;
    }
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.handle.db.transaction(async (tx) => {
      const current = await this.lockTeam(tx, auth.organizationId, id);
      await tx.delete(teams).where(eq(teams.id, id));
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'team.deleted',
        resourceType: 'team',
        resourceId: id,
        oldValues: { name: current.name },
        meta,
      });
    });
  }

  async addMember(auth: AuthContext, teamId: string, userId: string, meta: RequestMeta) {
    await this.handle.db.transaction(async (tx) => {
      await this.lockTeam(tx, auth.organizationId, teamId);
      await this.assertUserInOrg(tx, auth.organizationId, userId);
      const added = await tx.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing().returning();
      if (!added.length) return;
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'team.member_added',
        resourceType: 'team',
        resourceId: teamId,
        newValues: { userId },
        meta,
      });
    });
  }

  async removeMember(auth: AuthContext, teamId: string, userId: string, meta: RequestMeta) {
    await this.handle.db.transaction(async (tx) => {
      await this.lockTeam(tx, auth.organizationId, teamId);
      const removed = await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .returning();
      if (!removed.length) return;
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'team.member_removed',
        resourceType: 'team',
        resourceId: teamId,
        oldValues: { userId },
        meta,
      });
    });
  }

  private async assertUserInOrg(tx: Transaction, organizationId: string, userId: string) {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
  }
}
