/**
 * Spec §14–15: hybrid lead scoring. Deterministic rules are explainable and free; the AI score (from the
 * latest validated analysis) is blended in by configurable weights. Pure functions — facts come from rescore.ts.
 */

export interface LeadFacts {
  email: string | null;
  phone: string | null;
  budget: number | null;
  notes: string | null;
  /** Customer-visible messages only (no internal notes). Any order. */
  messages: { direction: 'INBOUND' | 'OUTBOUND'; at: Date; text: string }[];
  completedFollowupsAt: Date[];
}

export const RULE_KEYS = [
  'business_email',
  'has_phone',
  'budget_stated',
  'product_inquiry',
  'pricing_inquiry',
  'demo_request',
  'replied_within_24h',
  'no_response_after_followups',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface ScoringConfig {
  rules: Record<RuleKey, { enabled: boolean; points: number }>;
  ruleWeight: number;
  aiWeight: number;
  hotThreshold: number;
  warmThreshold: number;
}

export const RULE_LABELS: Record<RuleKey, string> = {
  business_email: 'Business email (not free mail)',
  has_phone: 'Phone number on file',
  budget_stated: 'Budget stated',
  product_inquiry: 'Customer has messaged us',
  pricing_inquiry: 'Asked about pricing',
  demo_request: 'Asked for a demo or trial',
  replied_within_24h: 'Replied within 24h of our message',
  no_response_after_followups: 'No response after 2+ follow-ups',
};

export const DEFAULT_SCORING: ScoringConfig = {
  rules: {
    business_email: { enabled: true, points: 20 },
    has_phone: { enabled: true, points: 5 },
    budget_stated: { enabled: true, points: 10 },
    product_inquiry: { enabled: true, points: 15 },
    pricing_inquiry: { enabled: true, points: 20 },
    demo_request: { enabled: true, points: 15 },
    replied_within_24h: { enabled: true, points: 10 },
    no_response_after_followups: { enabled: true, points: -15 },
  },
  ruleWeight: 50,
  aiWeight: 50,
  hotThreshold: 80,
  warmThreshold: 50,
};

/** Stored settings are partial; defaults fill the gaps so new rules apply to existing orgs. */
export function resolveScoringConfig(stored: Partial<Omit<ScoringConfig, 'rules'>> & { rules?: Partial<ScoringConfig['rules']> } = {}): ScoringConfig {
  return {
    ...DEFAULT_SCORING,
    ...Object.fromEntries(Object.entries(stored).filter(([k, v]) => k !== 'rules' && v !== undefined && v !== null)),
    rules: { ...DEFAULT_SCORING.rules, ...(stored.rules ?? {}) },
  };
}

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
]);

// English and Bangla. Word boundaries do not work for Bangla script, so those terms match as substrings.
const PRICING = /\b(price|prices|pricing|cost|costs|quote|quotation|rate|rates|how much)\b|দাম|মূল্য|খরচ|রেট/i;
const DEMO = /\b(demo|trial|walkthrough|presentation)\b|ডেমো/i;

const DAY = 24 * 3_600_000;

function matches(key: RuleKey, f: LeadFacts): boolean {
  const inbound = f.messages.filter((m) => m.direction === 'INBOUND');
  const customerText = [...inbound.map((m) => m.text), f.notes ?? ''];
  switch (key) {
    case 'business_email': {
      const domain = f.email?.split('@')[1]?.toLowerCase();
      return !!domain && !FREE_MAIL.has(domain);
    }
    case 'has_phone':
      return !!f.phone;
    case 'budget_stated':
      return (f.budget ?? 0) > 0;
    case 'product_inquiry':
      return inbound.length > 0;
    case 'pricing_inquiry':
      return customerText.some((t) => PRICING.test(t));
    case 'demo_request':
      return customerText.some((t) => DEMO.test(t));
    case 'replied_within_24h': {
      const outbound = f.messages.filter((m) => m.direction === 'OUTBOUND').map((m) => m.at.getTime());
      return inbound.some((i) => outbound.some((o) => o < i.at.getTime() && i.at.getTime() - o <= DAY));
    }
    case 'no_response_after_followups': {
      const lastReply = Math.max(-Infinity, ...inbound.map((m) => m.at.getTime()));
      const touches = [
        ...f.messages.filter((m) => m.direction === 'OUTBOUND').map((m) => m.at.getTime()),
        ...f.completedFollowupsAt.map((d) => d.getTime()),
      ].filter((t) => t > lastReply);
      return touches.length >= 2;
    }
  }
}

export function computeRuleScore(facts: LeadFacts, config: ScoringConfig): { score: number; matched: { key: RuleKey; points: number }[] } {
  const matched = RULE_KEYS.filter((k) => config.rules[k].enabled && matches(k, facts)).map((key) => ({ key, points: config.rules[key].points }));
  const sum = matched.reduce((s, m) => s + m.points, 0);
  return { score: Math.max(0, Math.min(100, sum)), matched };
}

export function combineScore(ruleScore: number, aiScore: number | null, config: ScoringConfig): number {
  const total = config.ruleWeight + config.aiWeight;
  if (aiScore === null || config.aiWeight === 0 || total === 0) return ruleScore;
  return Math.round((ruleScore * config.ruleWeight + aiScore * config.aiWeight) / total);
}

export function temperatureFor(score: number, config: Pick<ScoringConfig, 'hotThreshold' | 'warmThreshold'>): 'HOT' | 'WARM' | 'COLD' {
  return score >= config.hotThreshold ? 'HOT' : score >= config.warmThreshold ? 'WARM' : 'COLD';
}
