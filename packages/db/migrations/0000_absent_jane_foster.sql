CREATE TYPE "public"."item_status" AS ENUM('draft', 'sent', 'cooking', 'ready', 'served', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('waiter', 'cook', 'manager');--> statement-breakpoint
CREATE TYPE "public"."station" AS ENUM('kitchen', 'bar');--> statement-breakpoint
CREATE TABLE "dishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price" integer NOT NULL,
	"station" "station" NOT NULL,
	"stock" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dishes_price_nonneg" CHECK ("dishes"."price" >= 0),
	CONSTRAINT "dishes_stock_nonneg" CHECK ("dishes"."stock" is null or "dishes"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dish_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min" integer NOT NULL,
	"max" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "modifier_groups_min_nonneg" CHECK ("modifier_groups"."min" >= 0),
	CONSTRAINT "modifier_groups_max_positive" CHECK ("modifier_groups"."max" >= 1),
	CONSTRAINT "modifier_groups_min_le_max" CHECK ("modifier_groups"."min" <= "modifier_groups"."max")
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"surcharge" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "modifiers_surcharge_nonneg" CHECK ("modifiers"."surcharge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_counters" (
	"day" date PRIMARY KEY NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "order_counters_last_nonneg" CHECK ("order_counters"."last" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"modifier_id" uuid,
	"name" text NOT NULL,
	"surcharge" integer NOT NULL,
	CONSTRAINT "order_item_modifiers_surcharge_nonneg" CHECK ("order_item_modifiers"."surcharge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"dish_name" text NOT NULL,
	"station" "station" NOT NULL,
	"unit_price" integer NOT NULL,
	"guest" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"cooking_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "order_items_price_nonneg" CHECK ("order_items"."unit_price" >= 0),
	CONSTRAINT "order_items_guest_positive" CHECK ("order_items"."guest" >= 1),
	CONSTRAINT "order_items_comment_len" CHECK (char_length("order_items"."comment") <= 200),
	CONSTRAINT "order_items_sent_consistency" CHECK (("order_items"."status" = 'draft') = ("order_items"."sent_at" is null) or "order_items"."status" = 'cancelled')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"day" date NOT NULL,
	"table_id" uuid NOT NULL,
	"waiter_id" uuid NOT NULL,
	"guests" integer NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"subtotal" integer,
	"service_fee" integer,
	"total" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "orders_number_positive" CHECK ("orders"."number" > 0),
	CONSTRAINT "orders_guests_range" CHECK ("orders"."guests" between 1 and 50),
	CONSTRAINT "orders_version_nonneg" CHECK ("orders"."version" >= 0),
	CONSTRAINT "orders_paid_consistency" CHECK (("orders"."status" = 'paid') = ("orders"."total" is not null and "orders"."paid_at" is not null and "orders"."subtotal" is not null and "orders"."service_fee" is not null)),
	CONSTRAINT "orders_total_sum" CHECK ("orders"."total" is null or "orders"."total" = "orders"."subtotal" + "orders"."service_fee"),
	CONSTRAINT "orders_amounts_nonneg" CHECK (coalesce("orders"."subtotal", 0) >= 0 and coalesce("orders"."service_fee", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" integer NOT NULL,
	"tendered" integer,
	"change" integer DEFAULT 0 NOT NULL,
	"label" text,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_cash_or_card" CHECK (("payments"."method" = 'cash' and "payments"."tendered" is not null and "payments"."tendered" >= "payments"."amount" and "payments"."change" = "payments"."tendered" - "payments"."amount")
        or ("payments"."method" = 'card' and "payments"."tendered" is null and "payments"."change" = 0))
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"seats" integer NOT NULL,
	CONSTRAINT "restaurant_tables_number_unique" UNIQUE("number"),
	CONSTRAINT "tables_number_positive" CHECK ("restaurant_tables"."number" > 0),
	CONSTRAINT "tables_seats_positive" CHECK ("restaurant_tables"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_expiry_after_creation" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_len" CHECK (char_length("users"."username") between 3 and 32)
);
--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_item_id_order_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_id_users_id_fk" FOREIGN KEY ("waiter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dishes_category_idx" ON "dishes" USING btree ("category");--> statement-breakpoint
CREATE INDEX "modifier_groups_dish_idx" ON "modifier_groups" USING btree ("dish_id");--> statement-breakpoint
CREATE INDEX "modifiers_group_idx" ON "modifiers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "order_item_modifiers_item_idx" ON "order_item_modifiers" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_dish_idx" ON "order_items" USING btree ("dish_id");--> statement-breakpoint
CREATE INDEX "order_items_kitchen_idx" ON "order_items" USING btree ("sent_at") WHERE "order_items"."status" in ('sent', 'cooking', 'ready');--> statement-breakpoint
CREATE UNIQUE INDEX "orders_day_number_uq" ON "orders" USING btree ("day","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_open_per_table_uq" ON "orders" USING btree ("table_id") WHERE "orders"."status" = 'open';--> statement-breakpoint
CREATE INDEX "orders_day_status_idx" ON "orders" USING btree ("day","status");--> statement-breakpoint
CREATE INDEX "orders_waiter_idx" ON "orders" USING btree ("waiter_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username"));