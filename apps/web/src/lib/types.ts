export type RoleKey = 'ADMIN' | 'MANAGER' | 'AGENT' | 'ANALYST' | 'VIEWER';
export const ROLES: RoleKey[] = ['ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'];

export interface Identity {
  user: { id: string; email: string; fullName: string; status: string; role: RoleKey; timezone: string };
  organization: { id: string; name: string; slug: string };
  permissions: string[];
}

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  role: RoleKey | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  members: { id: string; fullName: string }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
}

export interface Stage {
  id: string;
  key: string;
  name: string;
  color: string;
  outcome: 'OPEN' | 'WON' | 'LOST';
  position?: number;
  probability?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export interface Lead {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  location: string | null;
  industry: string | null;
  notes: string | null;
  priority: Priority;
  score: number | null;
  temperature: 'COLD' | 'WARM' | 'HOT' | null;
  pipelineId: string;
  source: { id: string; name: string; type: string };
  stage: Stage;
  owner: { id: string; fullName: string } | null;
  tags: string[];
  convertedAt: string | null;
  lostAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}
