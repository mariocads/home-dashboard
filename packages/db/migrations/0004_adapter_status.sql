CREATE TABLE "adapter_status" (
	"name" text PRIMARY KEY NOT NULL,
	"target" text,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
