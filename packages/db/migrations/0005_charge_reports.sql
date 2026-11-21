CREATE TABLE "charge_reports" (
	"quarter" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"csv" text,
	"csv_sha256" text,
	"session_count" integer,
	"energy_kwh" double precision,
	"fetched_at" timestamp with time zone,
	"refresh_requested_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_sha256" text,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"test_requested_at" timestamp with time zone,
	"test_sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
