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

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}
