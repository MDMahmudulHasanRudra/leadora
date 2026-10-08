import type { AutomationCondition } from '@leadora/database';

/** Spec §40 conditions: a flat AND-list over lead and event facts. The catalog drives validation and the UI. */
export const CONDITION_FIELDS = {
  'lead.temperature': { label: 'Lead temperature', type: 'enum', options: ['HOT', 'WARM', 'COLD'] },
  'lead.score': { label: 'Lead score', type: 'number' },
  'lead.priority': { label: 'Lead priority', type: 'enum', options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
  'lead.stage': { label: 'Lead stage (key)', type: 'text' },
  'lead.stageOutcome': { label: 'Lead outcome', type: 'enum', options: ['OPEN', 'WON', 'LOST'] },
  'lead.source': { label: 'Lead source type', type: 'text' },
  'lead.owner': { label: 'Lead owner (user id)', type: 'text' },
  'lead.tags': { label: 'Lead tags', type: 'tags' },
  'lead.country': { label: 'Lead country (ISO code)', type: 'text' },
  'lead.budget': { label: 'Lead budget', type: 'number' },
  'event.to': { label: 'Changed to (stage key or score)', type: 'text' },
  'event.from': { label: 'Changed from (stage key or score)', type: 'text' },
  'event.temperatureTo': { label: 'Temperature changed to', type: 'enum', options: ['HOT', 'WARM', 'COLD'] },
  'message.text': { label: 'Message text', type: 'text' },
  'message.channel': { label: 'Message channel', type: 'text' },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

export const CONDITION_OPS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type Facts = Partial<Record<ConditionField, unknown>>;

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const asList = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [v]).map(norm);

function test(op: ConditionOp, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);
    case 'eq':
      return norm(String(actual ?? '')) === norm(String(expected ?? ''));
    case 'neq':
      return norm(String(actual ?? '')) !== norm(String(expected ?? ''));
    case 'in':
      return asList(expected).includes(norm(String(actual ?? '')));
    case 'not_in':
      return !asList(expected).includes(norm(String(actual ?? '')));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (actual === null || actual === undefined || actual === '') return false;
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
    }
    case 'contains':
    case 'not_contains': {
      const needle = String(norm(String(expected ?? '')));
      const hit = Array.isArray(actual) ? actual.map(norm).includes(needle) : String(norm(String(actual ?? ''))).includes(needle);
      return op === 'contains' ? hit : !hit;
    }
  }
}

export function evaluateConditions(conditions: AutomationCondition[], facts: Facts): boolean {
  return conditions.every((c) => test(c.op as ConditionOp, facts[c.field as ConditionField], c.value));
}

/** Simple {{lead.fullName}}-style placeholders for notification and email text. Unknown keys become empty. */
export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? '' : String(v);
  });
}
