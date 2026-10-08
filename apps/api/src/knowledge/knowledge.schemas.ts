import { z } from 'zod';

export const collectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    visibility: z.enum(['ORGANIZATION', 'TEAMS']).default('ORGANIZATION'),
    teamIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine((v) => v.visibility === 'ORGANIZATION' || v.teamIds.length > 0, { path: ['teamIds'], message: 'Choose at least one team' });
export type CollectionInput = z.infer<typeof collectionSchema>;

export const uploadFieldsSchema = z.object({ collectionId: z.uuid(), title: z.string().trim().min(1).max(200).optional() });
export const textSourceSchema = z.object({
  collectionId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(10).max(1_000_000),
});
export const urlSourceSchema = z.object({ collectionId: z.uuid(), url: z.string().trim().min(1).max(2000), title: z.string().trim().min(1).max(200).optional() });
export const listDocumentsSchema = z.object({ collectionId: z.uuid().optional() });

export const searchSchema = z.object({ query: z.string().trim().min(2).max(500), collectionIds: z.array(z.uuid()).max(20).optional() });
export const askSchema = z.object({ question: z.string().trim().min(3).max(1000), collectionIds: z.array(z.uuid()).max(20).optional() });

export const settingsSchema = z
  .object({ topK: z.number().int().min(1).max(20), minSimilarity: z.number().min(0).max(1) })
  .partial();

/** Spec §34/§37: what the model must return — ids of the numbered sources it actually used. */
export const answerSchema = z.strictObject({
  answer: z.string().max(3000),
  citations: z.array(z.string().max(5)).max(12),
  insufficientEvidence: z.boolean(),
});
