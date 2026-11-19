CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"content_hash" text NOT NULL,
	"from_ts" timestamp with time zone,
	"to_ts" timestamp with time zone,
	"row_count" integer NOT NULL,
	"inserted" integer NOT NULL,
	"updated" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"issue_count" integer NOT NULL,
	"gap_count" integer NOT NULL,
	"total_kwh" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
