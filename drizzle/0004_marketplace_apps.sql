CREATE TABLE "marketplace_apps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_apps_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_client_id_unique";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "secret_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "marketplace_app_id" bigint;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_marketplace_app_id_marketplace_apps_id_fk" FOREIGN KEY ("marketplace_app_id") REFERENCES "public"."marketplace_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_local_client_id_idx" ON "applications" USING btree ("client_id") WHERE marketplace_app_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_portal_client_id_idx" ON "applications" USING btree ("portal_id","client_id");