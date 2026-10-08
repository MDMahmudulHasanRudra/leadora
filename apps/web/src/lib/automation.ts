export const TRIGGER_LABELS: Record<string, string> = {
  'lead.created': 'A lead is created',
  'lead.stage_changed': 'A lead changes stage',
  'lead.score_changed': 'A lead’s score changes',
  'message.received': 'A customer message arrives',
  'followup.overdue': 'A follow-up becomes overdue',
  'lead.inactive': 'A lead has had no contact for a while',
};

export const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is not one of',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

export const ACTION_LABELS: Record<string, string> = {
  assign_lead: 'Assign the lead',
  change_stage: 'Move to stage',
  change_priority: 'Set priority',
  add_tag: 'Add a tag',
  create_followup: 'Schedule a follow-up',
  send_notification: 'Send a notification',
  send_email: 'Send an email',
  run_ai_analysis: 'Run AI lead analysis',
  draft_ai_reply: 'Draft an AI reply (internal note)',
};

export const DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  assign_lead: { mode: 'rules' },
  change_stage: { stageKey: '' },
  change_priority: { priority: 'HIGH' },
  add_tag: { tag: '' },
  create_followup: { type: 'CALL', inHours: 1, notes: '', assignTo: 'owner' },
  send_notification: { to: 'owner', title: 'Lead update: {{lead.fullName}}', body: '' },
  send_email: { inboxId: '', subject: '', body: 'Hi {{lead.firstName}},\n\n' },
  run_ai_analysis: {},
  draft_ai_reply: { language: 'en' },
};

/** Operators that make sense for a field type. */
export function opsFor(type: string): string[] {
  switch (type) {
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
    case 'enum':
      return ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'];
    case 'tags':
      return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    default:
      return ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'is_empty', 'is_not_empty'];
  }
}

export const needsValue = (op: string) => op !== 'is_empty' && op !== 'is_not_empty';
