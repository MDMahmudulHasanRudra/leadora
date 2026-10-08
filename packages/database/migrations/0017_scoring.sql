CREATE TABLE "scoring_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_weight" integer,
	"ai_weight" integer,
	"hot_threshold" integer,
	"warm_threshold" integer,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rule_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ai_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD CONSTRAINT "scoring_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD CONSTRAINT "scoring_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Until now only AI analysis wrote leads.score, so existing scores are AI scores.
UPDATE "leads" SET "ai_score" = "score" WHERE "score" IS NOT NULL;
