ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");
ALTER TABLE "Product" ADD CONSTRAINT "Product_barcode_check" CHECK ("barcode" IS NULL OR "barcode" ~ '^[A-Za-z0-9._/-]{1,64}$');
CREATE TABLE "ProductFavourite" (
  "userId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  PRIMARY KEY ("userId", "productId"),
  FOREIGN KEY ("businessId", "userId") REFERENCES "User"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductFavourite_businessId_userId_idx" ON "ProductFavourite"("businessId", "userId");
CREATE TABLE "ProductImport" (
  "businessId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdCount" INTEGER NOT NULL CHECK ("createdCount" BETWEEN 1 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("businessId", "requestKey"),
  FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON UPDATE CASCADE
);
