CREATE TABLE "installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payee" text NOT NULL,
	"amount_gross" double precision NOT NULL,
	"from_month" text NOT NULL,
	"to_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"payee" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"amount_gross" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"payee" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"price_net" double precision NOT NULL,
	"vat_pct" double precision DEFAULT 20 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"window" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "installments_key" ON "installments" USING btree ("payee","from_month");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_key" ON "invoices" USING btree ("payee","from_date","to_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_components_key" ON "tariff_components" USING btree ("payee","name","valid_from");