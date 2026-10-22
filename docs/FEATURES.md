# Catalogue and sales tools

## Updating an existing installation

Stop the website and API, keep PostgreSQL running, and run from the project folder:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run build
```

Restart ShopFlow. Setup.cmd applies migrations for fresh installations. Preserve your existing `.env` and database. The additive `202610220002_catalogue_tools` migration adds optional barcodes, personal favourites and an import retry ledger; existing products and transactions remain intact.

## Product filters and favourites

Inventory, purchasing and checkout support category, stock status, name/price/stock sorting, and name/SKU/barcode search together. Results are paginated with a stable secondary order. Low stock means positive quantity at or below the product's reorder level; out-of-stock products have a separate filter.

Use the star beside a product, then select **Favourites** for quick access. Favourites belong to the signed-in account, persist across sign-ins and never change another staff member's list. Cashiers can manage their own favourites without gaining catalogue-edit or cost access.

## Sales insights

Owners and managers see a **7-day / 30-day** net-sales chart and five top-selling products on Overview. Days follow **Asia/Colombo**, include today and include days with no activity. Refunds reduce net sales on their refund date; net sales can be negative. Open **View daily figures** for accessible exact LKR amounts.

Top-five products rank by units sold in the period **before returns**. Amounts and names come from historical sale snapshots. This is a sales view, not a profit calculation. Reports still provide detailed CSV/PDF exports.

## Barcode checkout

Owners/managers assign an optional barcode in **Inventory → Edit** or CSV import. Codes are unique within a store, case-sensitive, 1–64 characters, and accept letters, digits, `.`, `_`, `/` and `-`. Archived products retain their codes to prevent ambiguous reuse.

In Point of sale, focus **Scan or enter barcode**. Type a code or use a USB scanner configured as a keyboard with an **Enter** suffix. Each completed lookup adds one unit and refocuses the field. Unknown, archived and sold-out products cannot be added; basket quantities cannot exceed displayed availability. Completing the sale still validates stock and prices atomically on the server.

No camera permission is required. Keyboard entry was tested; physical scanner hardware remains a device-specific acceptance check.

## CSV import with preview

Owners and managers can select **Inventory → Import CSV** and download the template. Required columns: `sku,name,price,cost`. Optional: `reorderLevel,category,barcode`. Prices/costs are LKR decimal strings with at most two decimal places, without currency symbols or thousands separators.

```csv
sku,name,price,cost,reorderLevel,category,barcode
TEA-100,Tea 100g,450.00,320.00,5,Beverages,8901234567890
```

- Create categories first. A nonempty category must exactly match an existing category in your store.
- UTF-8 files may contain a BOM, quoted commas and quoted newlines. Maximum size: 512 KB; maximum rows: 500. Unknown or duplicate headers are rejected.
- Preview validates every row without saving. Fix all errors before importing. Existing/repeated SKUs and barcodes, including archived ones, are rejected.
- Import creates new products only. It never overwrites products or accepts stock quantities. New stock is **zero**; receive goods through Purchases to record stock movements.
- Commit revalidates and writes the entire batch atomically. One invalid row means zero products created. Concurrent batches cannot bypass unique constraints.
- After a network failure, use **Retry saved import**. The saved key/payload returns the original result instead of creating duplicates. A changed payload with that key is rejected.

CSV files may contain internal costs; use store-approved files. Temporary preview credentials, QA files and sample databases are excluded from distributed source.
