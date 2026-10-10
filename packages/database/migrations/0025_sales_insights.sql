CREATE TYPE "public"."insight_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "sales_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(60) NOT NULL,
	"title" text NOT NULL,
	"severity" "insight_severity" NOT NULL,
	"evidence" jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"generated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_insights" ADD CONSTRAINT "sales_insights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_insights_org_idx" ON "sales_insights" USING btree ("organization_id","generated_at" DESC NULLS LAST);