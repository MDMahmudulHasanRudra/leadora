CREATE TYPE "public"."stage_outcome" AS ENUM('OPEN', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."lead_source_type" AS ENUM('MANUAL', 'CSV', 'WEBSITE', 'LANDING_PAGE', 'API', 'WEBHOOK', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'EMAIL', 'REFERRAL', 'OTHER');--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"outcome" "stage_outcome" DEFAULT 'OPEN' NOT NULL,
	"color" varchar(9) DEFAULT '#71717a' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_pipeline_id_key_unique" UNIQUE("pipeline_id","key")
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "lead_source_type" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_country" varchar(2) DEFAULT 'BD' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipelines_organization_id_idx" ON "pipelines" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default_per_org" ON "pipelines" USING btree ("organization_id") WHERE "pipelines"."is_default";
--> statement-breakpoint
-- Backfill: organizations created before this migration get the defaults from apps/api/src/organizations/defaults.ts.
INSERT INTO "pipelines" ("organization_id", "name", "is_default")
SELECT o."id", 'Sales pipeline', true FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "pipelines" p WHERE p."organization_id" = o."id");--> statement-breakpoint
INSERT INTO "pipeline_stages" ("pipeline_id", "organization_id", "key", "name", "position", "probability", "outcome", "color")
SELECT p."id", p."organization_id", s.key, s.name, s.position, s.probability, s.outcome::"stage_outcome", s.color
FROM "pipelines" p
CROSS JOIN (VALUES
  ('NEW', 'New', 0, 5, 'OPEN', '#64748b'),
  ('CONTACTED', 'Contacted', 1, 10, 'OPEN', '#0ea5e9'),
  ('QUALIFIED', 'Qualified', 2, 25, 'OPEN', '#6366f1'),
  ('INTERESTED', 'Interested', 3, 40, 'OPEN', '#8b5cf6'),
  ('NEGOTIATION', 'Negotiation', 4, 60, 'OPEN', '#f59e0b'),
  ('FOLLOW_UP', 'Follow-up', 5, 50, 'OPEN', '#14b8a6'),
  ('CONVERTED', 'Converted', 6, 100, 'WON', '#22c55e'),
  ('LOST', 'Lost', 7, 0, 'LOST', '#ef4444')
) AS s(key, name, position, probability, outcome, color)
WHERE p."is_default" AND NOT EXISTS (SELECT 1 FROM "pipeline_stages" ps WHERE ps."pipeline_id" = p."id");--> statement-breakpoint
INSERT INTO "lead_sources" ("organization_id", "type", "name")
SELECT o."id", s.type::"lead_source_type", s.name
FROM "organizations" o
CROSS JOIN (VALUES ('MANUAL', 'Manual entry'), ('CSV', 'CSV import'), ('WEBSITE', 'Website form'), ('API', 'API')) AS s(type, name)
ON CONFLICT ("organization_id", "name") DO NOTHING;