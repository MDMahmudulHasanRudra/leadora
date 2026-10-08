DROP INDEX "activities_lead_created_idx";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "activities_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "activities_lead_seq_idx" ON "activities" USING btree ("lead_id","seq" DESC NULLS LAST);