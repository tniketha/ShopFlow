ALTER TABLE "Product" ADD COLUMN "photoKey" TEXT, ADD COLUMN "photoVersion" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_photoKey_check"
  CHECK ("photoKey" IS NULL OR "photoKey" IN ('none', 'custom', 'rice', 'tea', 'milk', 'coffee', 'sugar', 'soap', 'biscuits', 'oil', 'water'));
CREATE TABLE "ProductPhoto" (
  "productId" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  CONSTRAINT "ProductPhoto_product_fkey" FOREIGN KEY ("businessId", "productId")
    REFERENCES "Product"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductPhoto_size_check" CHECK (octet_length("content") <= 524288)
);
CREATE UNIQUE INDEX "ProductPhoto_businessId_productId_key" ON "ProductPhoto"("businessId", "productId");
