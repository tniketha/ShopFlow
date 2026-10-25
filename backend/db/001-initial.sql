CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'CASHIER');

CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrf" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceNo" SERIAL NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "User_businessId_id_key" ON "User"("businessId", "id");

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE UNIQUE INDEX "Category_businessId_id_key" ON "Category"("businessId", "id");

CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");

CREATE UNIQUE INDEX "Supplier_businessId_id_key" ON "Supplier"("businessId", "id");

CREATE INDEX "Product_businessId_active_idx" ON "Product"("businessId", "active");

CREATE UNIQUE INDEX "Product_businessId_id_key" ON "Product"("businessId", "id");

CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");

CREATE UNIQUE INDEX "Purchase_businessId_id_key" ON "Purchase"("businessId", "id");

CREATE UNIQUE INDEX "Purchase_businessId_requestKey_key" ON "Purchase"("businessId", "requestKey");

CREATE UNIQUE INDEX "Sale_invoiceNo_key" ON "Sale"("invoiceNo");

CREATE INDEX "Sale_businessId_createdAt_idx" ON "Sale"("businessId", "createdAt");

CREATE UNIQUE INDEX "Sale_businessId_id_key" ON "Sale"("businessId", "id");

CREATE UNIQUE INDEX "Sale_businessId_requestKey_key" ON "Sale"("businessId", "requestKey");

CREATE UNIQUE INDEX "SaleLine_businessId_id_key" ON "SaleLine"("businessId", "id");

ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_categoryId_fkey" FOREIGN KEY ("businessId", "categoryId") REFERENCES "Category"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_supplierId_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_businessId_purchaseId_fkey" FOREIGN KEY ("businessId", "purchaseId") REFERENCES "Purchase"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "Sale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_amounts_check"
  CHECK ("priceMinor" BETWEEN 0 AND 2000000000 AND "costMinor" BETWEEN 0 AND 2000000000 AND stock BETWEEN 0 AND 2000000000);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_check"
  CHECK ("totalMinor" BETWEEN 0 AND 2000000000 AND "paidMinor" BETWEEN "totalMinor" AND 2000000000);
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_amounts_check"
  CHECK (quantity BETWEEN 1 AND 100000 AND "priceMinor" BETWEEN 0 AND 2000000000 AND "costMinor" BETWEEN 0 AND 2000000000);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amounts_check"
  CHECK ("totalMinor" BETWEEN 0 AND 2000000000);
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_amounts_check"
  CHECK (quantity BETWEEN 1 AND 100000 AND "costMinor" BETWEEN 0 AND 2000000000);
