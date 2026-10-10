CREATE TYPE "public"."export_format" AS ENUM('CSV', 'XLSX');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" varchar(30) NOT NULL,
	"format" "export_format" NOT NULL,
	"fields" text[] NOT NULL,
	"filters" jsonb NOT NULL,
	"status" "export_status" DEFAULT 'QUEUED' NOT NULL,
	"row_count" integer,
	"storage_key" text,
	"file_name" text,
	"error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_exports_user_idx" ON "data_exports" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST);