CREATE TYPE "public"."custom_field_entity" AS ENUM('lead', 'contact', 'company');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'url', 'email', 'phone');--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity" "custom_field_entity" NOT NULL,
	"key" varchar(60) NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_org_entity_key_unique" UNIQUE("organization_id","entity","key")
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"field_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric(20, 6),
	"value_boolean" boolean,
	"value_date" date,
	"value_datetime" timestamp with time zone,
	"value_json" jsonb,
	CONSTRAINT "custom_field_values_field_id_entity_id_pk" PRIMARY KEY("field_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_values_entity_idx" ON "custom_field_values" USING btree ("entity_id");