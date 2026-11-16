ALTER TYPE "public"."order_status" ADD VALUE 'closed';--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_paid_consistency";--> statement-breakpoint
ALTER TABLE "dishes" ADD COLUMN "stock_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "stock_epoch" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_settled_consistency" CHECK (("orders"."status"::text in ('paid', 'closed')) = ("orders"."total" is not null and "orders"."subtotal" is not null and "orders"."service_fee" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_at_consistency" CHECK (("orders"."status"::text = 'paid') = ("orders"."paid_at" is not null));