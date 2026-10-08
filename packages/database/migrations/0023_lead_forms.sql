CREATE TYPE "public"."captcha_provider" AS ENUM('NONE', 'TURNSTILE', 'HCAPTCHA');--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" varchar(40) NOT NULL,
	"title" text,
	"success_message" text NOT NULL,
	"fields" jsonb NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"captcha_provider" "captcha_provider" DEFAULT 'NONE' NOT NULL,
	"captcha_site_key" text,
	"captcha_secret_enc" text,
	"tags" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"last_submission_at" timestamp (3) with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_public_key_unique" ON "lead_forms" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "lead_forms_org_idx" ON "lead_forms" USING btree ("organization_id");