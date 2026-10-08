import { z } from 'zod';

export const TOOLS = ['search_leads', 'team_performance', 'source_performance', 'list_followups', 'conversations_needing_attention', 'unsupported'] as const;
export type ToolName = (typeof TOOLS)[number];

/**
 * Spec §39: tools are explicit and typed. Strict mode needs every key present, so "not mentioned" is null.
 * The model only ever chooses a tool and its arguments; the server checks permissions and builds the query.
 */
export const planSchema = z.strictObject({
  tool: z.enum(TOOLS),
  leads: z
    .strictObject({
      temperatures: z.array(z.enum(['HOT', 'WARM', 'COLD'])).max(3).nullable(),
      stageKeys: z.array(z.string().max(50)).max(10).nullable(),
      outcome: z.enum(['OPEN', 'WON', 'LOST']).nullable(),
      owner: z.enum(['me', 'unassigned', 'any']).nullable(),
      sourceTypes: z.array(z.string().max(30)).max(10).nullable(),
      createdWithinDays: z.number().int().min(1).max(365).nullable(),
      noFollowupWithinHours: z.number().int().min(1).max(720).nullable(),
      hasOverdueFollowup: z.boolean().nullable(),
      minScore: z.number().int().min(0).max(100).nullable(),
      mentions: z.string().max(60).nullable(),
      text: z.string().max(100).nullable(),
      sort: z.enum(['score', 'newest', 'oldest_contact']).nullable(),
    })
    .nullable(),
  periodDays: z.number().int().min(1).max(365).nullable(),
  followups: z.enum(['overdue', 'due_today', 'upcoming']).nullable(),
  mineOnly: z.boolean().nullable(),
  explanation: z.string().max(300),
});
export type Plan = z.infer<typeof planSchema>;
export type LeadFilters = NonNullable<Plan['leads']>;

export const answerSchema = z.strictObject({
  answer: z.string().max(1200),
  highlights: z.array(z.string().max(200)).max(5),
});

export const querySchema = z.object({ question: z.string().trim().min(3).max(500) });
export type QueryInput = z.infer<typeof querySchema>;
