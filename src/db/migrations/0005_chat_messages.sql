CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kitchen_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"client_message_id" text NOT NULL,
	"change_set_id" text,
	"receipt" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_messages_role_ck" CHECK ("chat_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_turn_uq" ON "chat_messages" USING btree ("kitchen_id","user_id","client_message_id","role");--> statement-breakpoint
CREATE INDEX "chat_messages_history_idx" ON "chat_messages" USING btree ("kitchen_id","user_id","seq");