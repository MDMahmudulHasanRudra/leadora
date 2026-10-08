CREATE TYPE "public"."followup_status" AS ENUM('PENDING', 'COMPLETED', 'SKIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."followup_type" AS ENUM('CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM');--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"created_by_user_id" uuid,
	"type" "followup_type" NOT NULL,
	"status" "followup_status" DEFAULT 'PENDING' NOT NULL,
	"priority" "lead_priority" DEFAULT 'MEDIUM' NOT NULL,
	"scheduled_at" timestamp (3) with time zone NOT NULL,
	"notes" text,
	"outcome" text,
	"completed_at" timestamp (3) with time zone,
	"reminded_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followups_org_assignee_status_idx" ON "followups" USING btree ("organization_id","assigned_user_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "followups_lead_idx" ON "followups" USING btree ("lead_id","status","scheduled_at");