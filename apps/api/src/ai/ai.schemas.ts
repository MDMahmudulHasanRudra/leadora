import { LEAD_ACTIONS } from '@leadora/domain';
import { z } from 'zod';

// Lead analysis and reply drafting live in @leadora/domain so automations can run them in the worker.
export { type LeadAnalysis, leadAnalysisSchema, type ReplyRequest, replyRequestSchema } from '@leadora/domain';

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

export const DEFAULT_FEATURES = {
  leadAnalysis: true,
  conversationAnalysis: true,
  replySuggestions: true,
  knowledgeBase: true,
  nlSearch: true,
  autoReply: false,
};

const short = z.string().max(160);

/** Spec §31. */
export const conversationAnalysisSchema = z.strictObject({
  summary: z.string().max(600),
  intent: z.enum(['PURCHASE', 'INQUIRY', 'SUPPORT', 'COMPLAINT', 'PARTNERSHIP', 'SPAM', 'UNKNOWN']),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED']),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  buyingSignal: z.enum(['NONE', 'WEAK', 'MODERATE', 'STRONG']),
  productInterest: z.array(short).max(10),
  objections: z.array(short).max(10),
  questions: z.array(short).max(10),
  competitorMentions: z.array(short).max(10),
  riskFlags: z.array(short).max(10),
  recommendedNextAction: z.enum(LEAD_ACTIONS),
  score: z.number().int().min(0).max(100),
});
export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;
