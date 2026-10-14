CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"created_by" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"target_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_purpose_ck" CHECK ("invites"."purpose" in ('join', 'reset')),
	CONSTRAINT "invites_target_ck" CHECK (("invites"."purpose" = 'reset') = ("invites"."target_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "passphrase_hash" text;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_uq" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_kitchen_idx" ON "invites" USING btree ("kitchen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_signin_name_uq" ON "users" USING btree (lower("display_name")) WHERE "users"."passphrase_hash" is not null;