CREATE INDEX "applications_portal_id_idx" ON "applications" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "token_pairs_app_user_created_idx" ON "token_pairs" USING btree ("application_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "token_pairs_created_at_idx" ON "token_pairs" USING btree ("created_at");