CREATE TYPE "public"."channel_type" AS ENUM('EMAIL', 'WEB_CHAT', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('OPEN', 'PENDING', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."message_content_type" AS ENUM('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('LEAD', 'USER', 'SYSTEM', 'AI');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('RECEIVED', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inbox_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"subject" text,
	"status" "conversation_status" DEFAULT 'OPEN' NOT NULL,
	"assigned_user_id" uuid,
	"unread" boolean DEFAULT false NOT NULL,
	"last_direction" text,
	"last_message_at" timestamp (3) with time zone,
	"last_message_preview" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "channel_type" NOT NULL,
	"address" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inboxes_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sender_type" "message_sender" NOT NULL,
	"sender_user_id" uuid,
	"external_message_id" text,
	"content" text NOT NULL,
	"content_type" "message_content_type" DEFAULT 'TEXT' NOT NULL,
	"metadata" jsonb,
	"status" "message_status" NOT NULL,
	"error" text,
	"sent_at" timestamp (3) with time zone,
	"delivered_at" timestamp (3) with time zone,
	"read_at" timestamp (3) with time zone,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_approved" boolean,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inbox_id" uuid,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_event_status" DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (3) with time zone,
	CONSTRAINT "webhook_events_inbox_external_unique" UNIQUE("inbox_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_org_status_last_idx" ON "conversations" USING btree ("organization_id","status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_org_assignee_idx" ON "conversations" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_external_id_unique" ON "messages" USING btree ("organization_id","external_message_id") WHERE "messages"."external_message_id" is not null;