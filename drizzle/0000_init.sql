CREATE TABLE "applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"portal_id" bigint NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"title" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "portals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portals_origin_unique" UNIQUE("origin"),
	CONSTRAINT "portals_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "token_pairs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" bigint NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"scope" text NOT NULL,
	"params" jsonb NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_pairs_access_hash_unique" UNIQUE("access_hash"),
	CONSTRAINT "token_pairs_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_pairs" ADD CONSTRAINT "token_pairs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_pairs_refresh_expires_at_idx" ON "token_pairs" USING btree ("refresh_expires_at");