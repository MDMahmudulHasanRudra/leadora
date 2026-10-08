CREATE TABLE "ai_assistant_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"question" text NOT NULL,
	"tool" varchar(60),
	"plan" jsonb,
	"status" varchar(20) NOT NULL,
	"result_count" integer,
	"answer" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_assistant_queries" ADD CONSTRAINT "ai_assistant_queries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assistant_queries" ADD CONSTRAINT "ai_assistant_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_assistant_queries_user_idx" ON "ai_assistant_queries" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST);