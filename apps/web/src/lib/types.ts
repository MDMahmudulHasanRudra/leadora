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

export type CustomFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email'
  | 'phone';

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[] | null;
  required: boolean;
  position: number;
}

export type CustomFieldValue = string | number | boolean | string[];

export interface Lead {
  customFields: Record<string, CustomFieldValue>;
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  location: string | null;
  industry: string | null;
  notes: string | null;
  budget: number | null;
  priority: Priority;
  score: number | null;
  ruleScore: number | null;
  aiScore: number | null;
  scoreBreakdown: { rules: { key: string; points: number }[]; ruleScore: number; aiScore: number | null; ruleWeight: number; aiWeight: number } | null;
  contactId: string | null;
  companyId: string | null;
  nextFollowupAt: string | null;
  lastContactedAt: string | null;
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

export type FollowupType = 'CALL' | 'EMAIL' | 'MESSAGE' | 'MEETING' | 'CUSTOM';
export const FOLLOWUP_TYPES: FollowupType[] = ['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM'];

export interface Followup {
  id: string;
  type: FollowupType;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
  priority: Priority;
  scheduledAt: string;
  notes: string | null;
  outcome: string | null;
  completedAt: string | null;
  overdue: boolean;
  lead: { id: string; fullName: string };
  assignee: { id: string; fullName: string } | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'OPEN' | 'DONE';
  priority: Priority;
  dueAt: string | null;
  checklist: { text: string; done: boolean }[];
  completedAt: string | null;
  lead: { id: string; fullName: string } | null;
  assignee: { id: string; fullName: string } | null;
}

export interface ContactRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  domain: string | null;
}

export interface Dashboard {
  scope: 'organization' | 'mine';
  periodDays: number;
  totals: {
    leads: number;
    open: number;
    won: number;
    lost: number;
    hot: number;
    unassigned: number;
    newInPeriod: number;
    convertedInPeriod: number;
    conversionRate: number;
    followupsDueNext24h: number;
    overdueFollowups: number;
  };
  value: { won: number; pipeline: number; weightedPipeline: number };
  byStage: { id: string; key: string; name: string; color: string; outcome: string; count: number; value: number }[];
  bySource: { id: string; name: string; type: string; leads: number; won: number; conversionRate: number }[];
  team?: { userId: string; fullName: string; leads: number; open: number; won: number; conversionRate: number }[];
}

export interface AssignmentRule {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  strategy: 'USER' | 'ROUND_ROBIN' | 'LEAST_LOADED';
  conditions: { sourceTypes?: string[]; countries?: string[]; tags?: string[]; priorities?: string[] };
  targetUserId: string | null;
  targetTeamId: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export const MODEL_PROFILES = ['fast', 'balanced', 'reasoning', 'embedding'] as const;
export type ModelProfile = (typeof MODEL_PROFILES)[number];
export type ModelPrice = { input: number; cachedInput: number; output: number };

export interface AiSettings {
  provider: 'openai';
  enabled: boolean;
  platformEnabled: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  models: Partial<Record<ModelProfile, string>>;
  features: Record<string, boolean>;
  monthlyBudgetUsd: number | null;
  prices: Record<string, ModelPrice>;
  monthToDateSpendUsd: number;
}

export interface AiUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failed: number;
}

export interface AiUsage {
  today: AiUsageTotals;
  month: AiUsageTotals;
  byPurpose: (AiUsageTotals & { purpose: string })[];
  byModel: (AiUsageTotals & { model: string })[];
  byUser: (AiUsageTotals & { userId: string | null; fullName: string | null })[];
}

export interface PromptVersion {
  version: number;
  active: boolean;
  modelProfile: ModelProfile;
  maxOutputTokens: number;
  systemPrompt: string;
  notes: string | null;
  createdAt: string;
}

export interface PromptInfo {
  key: string;
  description: string;
  activeVersion: number;
  builtin: { version: 0; systemPrompt: string; modelProfile: ModelProfile; maxOutputTokens: number };
  versions: PromptVersion[];
}

export interface LeadAnalysis {
  summary: string;
  intent: string;
  buyingSignal: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  objections: string[];
  productInterest: string[];
  recommendedAction: string;
  rationale: string;
}
export interface ScoringSettings {
  ruleWeight: number;
  aiWeight: number;
  hotThreshold: number;
  warmThreshold: number;
  rules: { key: string; label: string; enabled: boolean; points: number }[];
}