-- Keep these CHECK constraints when extending the Prisma schema.
ALTER TABLE "Product" ADD CONSTRAINT "Product_money_stock_check" CHECK ("priceMinor" BETWEEN 0 AND 2000000000 AND "costMinor" BETWEEN 0 AND 2000000000 AND stock BETWEEN 0 AND 2000000000 AND "reorderLevel" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_money_check" CHECK ("totalMinor" BETWEEN 0 AND 2000000000 AND "paidMinor" BETWEEN "totalMinor" AND 2000000000);
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_amount_check" CHECK (quantity > 0 AND "returnedQuantity" BETWEEN 0 AND quantity AND "priceMinor" >= 0 AND "costMinor" >= 0);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_money_check" CHECK ("totalMinor" BETWEEN 0 AND 2000000000);
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_amount_check" CHECK (quantity > 0 AND "costMinor" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_money_check" CHECK ("totalMinor" BETWEEN 0 AND 2000000000);
ALTER TABLE "RefundLine" ADD CONSTRAINT "RefundLine_amount_check" CHECK (quantity > 0 AND "priceMinor" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_check" CHECK (delta <> 0 AND kind IN ('PURCHASE', 'SALE', 'REFUND'));
