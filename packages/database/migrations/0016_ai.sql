CREATE TYPE "public"."ai_run_status" AS ENUM('SUCCEEDED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid NOT NULL,
	"purpose" varchar(60) NOT NULL,
	"run_id" uuid,
	"result" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prompt_key" varchar(60) NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"model_profile" varchar(20) NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"temperature" numeric(3, 2),
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompt_versions_org_key_version_unique" UNIQUE("organization_id","prompt_key","version")
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"provider" varchar(30) NOT NULL,
	"model" text,
	"purpose" varchar(60) NOT NULL,
	"prompt_key" varchar(60),
	"prompt_version" integer,
	"request_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"attempts" integer DEFAULT 1 NOT NULL,
	"status" "ai_run_status" NOT NULL,
	"error_code" varchar(60),
	"entity_type" varchar(30),
	"entity_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(30) DEFAULT 'openai' NOT NULL,
	"api_key_enc" text,
	"api_key_last4" varchar(4),
	"enabled" boolean DEFAULT false NOT NULL,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_budget_usd" numeric(12, 2),
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_entity_idx" ON "ai_analyses" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_versions_one_active" ON "ai_prompt_versions" USING btree ("organization_id","prompt_key") WHERE "ai_prompt_versions"."active";--> statement-breakpoint
CREATE INDEX "ai_runs_org_created_idx" ON "ai_runs" USING btree ("organization_id","created_at" DESC NULLS LAST);