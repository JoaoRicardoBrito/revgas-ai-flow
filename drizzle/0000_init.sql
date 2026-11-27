CREATE TYPE "public"."channel" AS ENUM('simulator', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'completed', 'abandoned', 'handed_off');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."order_outcome" AS ENUM('in_progress', 'sale_created', 'abandoned', 'handed_off', 'canceled');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "channel" NOT NULL,
	"contact" text NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"step" text DEFAULT 'start' NOT NULL,
	"collected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revgas_customer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"external_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_metrics" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"first_message_at" timestamp with time zone NOT NULL,
	"sale_created_at" timestamp with time zone,
	"revgas_sale_id" integer,
	"turns" integer DEFAULT 0 NOT NULL,
	"handed_off" boolean DEFAULT false NOT NULL,
	"handed_off_at" timestamp with time zone,
	"handoff_reason" text,
	"outcome" "order_outcome" DEFAULT 'in_progress' NOT NULL,
	"canceled_at" timestamp with time zone,
	"llm_ms" integer DEFAULT 0 NOT NULL,
	"revgas_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_metrics_turns_non_negative" CHECK ("order_metrics"."turns" >= 0),
	CONSTRAINT "order_metrics_timings_non_negative" CHECK ("order_metrics"."llm_ms" >= 0 AND "order_metrics"."revgas_ms" >= 0),
	CONSTRAINT "order_metrics_sale_after_first_message" CHECK ("order_metrics"."sale_created_at" IS NULL OR "order_metrics"."sale_created_at" >= "order_metrics"."first_message_at"),
	CONSTRAINT "order_metrics_handoff_consistent" CHECK ("order_metrics"."handed_off" = ("order_metrics"."handed_off_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "order_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_metrics" ADD CONSTRAINT "order_metrics_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_one_active_per_contact" ON "conversations" USING btree ("channel","contact") WHERE "conversations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "conversations_last_message_at" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_id_unique" ON "messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_at" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "order_metrics_first_message_at" ON "order_metrics" USING btree ("first_message_at");