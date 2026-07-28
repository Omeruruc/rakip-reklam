CREATE TYPE "public"."match_status" AS ENUM('unverified', 'matched', 'no_page', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_ad', 'stopped_ad');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ads" (
	"ad_archive_id" varchar(64) PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"creative_text" text,
	"creative_title" text,
	"image_url" text,
	"video_url" text,
	"landing_url" text,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stopped_at" timestamp with time zone,
	"raw" text
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer NOT NULL,
	"name" varchar(300) NOT NULL,
	"instagram_handle" varchar(200),
	"fb_page_id" varchar(64),
	"fb_page_name" varchar(300),
	"match_status" "match_status" DEFAULT 'unverified' NOT NULL,
	"matched_by" varchar(200),
	"matched_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"name" varchar(300) NOT NULL,
	"city" varchar(100),
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_archive_id" varchar(64) NOT NULL,
	"type" "notification_type" NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"ads_found" integer DEFAULT 0 NOT NULL,
	"new_ads" integer DEFAULT 0 NOT NULL,
	"stopped_ads" integer DEFAULT 0 NOT NULL,
	"competitors_scanned" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4),
	"error" text,
	"apify_run_id" varchar(64),
	"actor_id" varchar(200),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ad_archive_id_ads_ad_archive_id_fk" FOREIGN KEY ("ad_archive_id") REFERENCES "public"."ads"("ad_archive_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ads_competitor_idx" ON "ads" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "ads_active_idx" ON "ads" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ads_first_seen_idx" ON "ads" USING btree ("first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_unique" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_dealer_handle_unique" ON "competitors" USING btree ("dealer_id","instagram_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_dealer_name_unique" ON "competitors" USING btree ("dealer_id","name");--> statement-breakpoint
CREATE INDEX "competitors_match_status_idx" ON "competitors" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "competitors_fb_page_idx" ON "competitors" USING btree ("fb_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dealers_brand_name_unique" ON "dealers" USING btree ("brand_id","name");--> statement-breakpoint
CREATE INDEX "dealers_brand_idx" ON "dealers" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_ad_type_unique" ON "notifications" USING btree ("ad_archive_id","type");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_brand_idx" ON "scrape_runs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_started_idx" ON "scrape_runs" USING btree ("started_at");