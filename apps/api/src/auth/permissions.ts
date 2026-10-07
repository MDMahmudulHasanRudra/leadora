// Spec §7.3. Permission keys live in code; roles grant them via role_permissions rows.
export const PERMISSIONS = [
  'organization.manage',
  'user.view',
  'user.create',
  'user.update',
  'user.disable',
  'team.view',
  'team.manage',
  'lead.view',
  'lead.create',
  'lead.update',
  'lead.delete',
  'lead.assign',
  'lead.export',
  'lead.import',
  'conversation.view',
  'conversation.reply',
  'conversation.assign',
  'followup.view',
  'followup.create',
  'followup.complete',
  'knowledge.view',
  'knowledge.manage',
  'ai.use',
  'ai.configure',
  'ai.auto_reply',
  'ai.execute_actions',
  'automation.view',
  'automation.manage',
  'analytics.view',
  'analytics.export',
  'settings.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleKey = 'ADMIN' | 'MANAGER' | 'AGENT' | 'ANALYST' | 'VIEWER';

const READ_ONLY: Permission[] = ['user.view', 'team.view', 'lead.view', 'conversation.view', 'followup.view'];

export const DEFAULT_ROLES: Record<RoleKey, { name: string; permissions: readonly Permission[] }> = {
  ADMIN: { name: 'Admin', permissions: PERMISSIONS },
  MANAGER: {
    name: 'Manager',
    permissions: [
      ...READ_ONLY,
      'team.manage',
      'lead.create',
      'lead.update',
      'lead.assign',
      'lead.export',
      'lead.import',
      'conversation.reply',
      'conversation.assign',
      'followup.create',
      'followup.complete',
      'knowledge.view',
      'knowledge.manage',
      'ai.use',
      'automation.view',
      'analytics.view',
      'analytics.export',
    ],
  },
  AGENT: {
    name: 'Agent',
    permissions: [
      ...READ_ONLY,
      'lead.create',
      'lead.update',
      'conversation.reply',
      'followup.create',
      'followup.complete',
      'knowledge.view',
      'ai.use',
    ],
  },
  ANALYST: { name: 'Analyst', permissions: [...READ_ONLY, 'analytics.view', 'analytics.export'] },
  VIEWER: { name: 'Viewer', permissions: [...READ_ONLY, 'analytics.view'] },
};

export const ROLE_KEYS = Object.keys(DEFAULT_ROLES) as RoleKey[];
