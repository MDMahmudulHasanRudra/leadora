import { z } from 'zod';

const PROFILES = ['fast', 'balanced', 'reasoning', 'embedding'] as const;

export const updateSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['openai']),
    // '' removes the key.
    apiKey: z.union([z.literal(''), z.string().trim().min(20).max(400)]),
    models: z.partialRecord(z.enum(PROFILES), z.string().trim().max(100)),
    features: z
      .object({
        leadAnalysis: z.boolean(),
        conversationAnalysis: z.boolean(),
        replySuggestions: z.boolean(),
        knowledgeBase: z.boolean(),
        nlSearch: z.boolean(),
        autoReply: z.boolean(),
      })
      .partial(),
    monthlyBudgetUsd: z
      .number()
      .nonnegative()
      .max(1_000_000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use whole cents')
      .nullable(),
    prices: z.record(
      z.string().trim().min(1).max(100),
      z.object({ input: z.number().nonnegative(), cachedInput: z.number().nonnegative(), output: z.number().nonnegative() }),
    ),
  })
  .partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const promptVersionSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(20_000),
  modelProfile: z.enum(PROFILES),
  maxOutputTokens: z.number().int().min(50).max(16_000),
  temperature: z.number().min(0).max(2).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type PromptVersionInput = z.infer<typeof promptVersionSchema>;

/** Spec §30/§31: every machine-consumed AI result has a schema. Strict objects → strict JSON schema. */
export const leadAnalysisSchema = z.strictObject({
  summary: z.string().max(600),
  intent: z.enum(['PURCHASE', 'INQUIRY', 'SUPPORT', 'COMPLAINT', 'PARTNERSHIP', 'SPAM', 'UNKNOWN']),
  buyingSignal: z.enum(['NONE', 'WEAK', 'MODERATE', 'STRONG']),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  score: z.number().int().min(0).max(100),
  objections: z.array(z.string().max(120)).max(10),
  productInterest: z.array(z.string().max(120)).max(10),
  recommendedAction: z.enum(['CALL_NOW', 'SEND_PRICING', 'OFFER_DEMO', 'FOLLOW_UP_LATER', 'NURTURE', 'ESCALATE_TO_MANAGER', 'DISQUALIFY']),
  rationale: z.string().max(400),
});
export type LeadAnalysis = z.infer<typeof leadAnalysisSchema>;

export const DEFAULT_FEATURES = {
  leadAnalysis: true,
  conversationAnalysis: true,
  replySuggestions: true,
  knowledgeBase: true,
  nlSearch: true,
  autoReply: false,
};

export function temperatureFor(score: number): 'HOT' | 'WARM' | 'COLD' {
  return score >= 80 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD';
}
