CREATE TABLE "sheet_syncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_archive_id" varchar(64) NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "sheet_syncs" ADD CONSTRAINT "sheet_syncs_ad_archive_id_ads_ad_archive_id_fk" FOREIGN KEY ("ad_archive_id") REFERENCES "public"."ads"("ad_archive_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_syncs_ad_unique" ON "sheet_syncs" USING btree ("ad_archive_id");--> statement-breakpoint
CREATE INDEX "sheet_syncs_created_idx" ON "sheet_syncs" USING btree ("created_at");