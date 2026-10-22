# ShopFlow feature priorities

These are proposed improvements, not features already implemented. Priorities reflect ShopFlow's current single-store, cash-only grocery workflow and its use as a portfolio project.

| Order | Improvement                                | What it would add                                                                                                                                                                                                       |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Barcode checkout and label printing        | Scan products using a USB scanner, with camera scanning as an optional follow-up. Preserve server-side price and stock checks.                                                                                          |
| 2     | Stock counts, damage and expiry management | Audited stock-count adjustments, damaged/expired stock reasons, purchase batches and alerts for approaching expiry.                                                                                                     |
| 3     | Better sales and profit dashboards         | Daily/weekly charts, top-selling products, period comparisons and gross profit based on sale cost snapshots and refunds. Gross profit is not net business profit.                                                       |
| 4     | Suggested reordering                       | Show sales velocity, estimated days of stock and suggested purchase quantities using supplier lead times. Show insufficient-history states and require manager approval before ordering.                                |
| 5     | Customers, loyalty and digital receipts    | Optional customer accounts, purchase history, a points ledger and opt-in receipts. Reverse points correctly when sales are refunded.                                                                                    |
| 6     | Shift opening and cash reconciliation      | Opening float, cashier sessions, expected versus counted cash and an audited closing report.                                                                                                                            |
| 7     | LANKAQR and other payment methods          | Integrate through an appropriate bank/payment provider. Track pending, confirmed, failed and refunded payments, and verify confirmation before marking a sale paid. Displaying a QR code alone does not verify payment. |
| 8     | Online catalogue and click-and-collect     | A customer-facing catalogue linked to the same stock source, with explicit stock reservations, expiry of unpaid holds and order statuses.                                                                               |

For the next implementation, combine **barcode checkout, audited stock adjustments and dashboard charts**. Add expiry/batch tracking after deciding how the store receives and sells mixed-expiry stock. This provides a useful store workflow and a clear portfolio demonstration before introducing external payment dependencies.

## What is current in retail technology

Retail platforms are investing in connected online/in-store operations, real-time inventory, customer loyalty and operational assistance. These are directions for ShopFlow rather than evidence that every feature is necessary for a small store. AI-assisted insights can follow reliable reporting and sufficient historical data; automatic stock changes or purchase orders should remain explicit, permission-controlled actions.

Sources checked on 22 October 2026:

- [Deloitte's 2026 retail outlook](https://www.deloitte.com/global/en/insights/industry/retail-distribution/retail-distribution-industry-outlook.html) discusses AI and retail operating priorities.
- [Shopify POS features](https://www.shopify.com/pos/features) documents barcode scanning, inventory management, customer workflows and connected selling.
- [Shopify's retail digital transformation discussion](https://www.shopify.com/enterprise/blog/retail-store-digital-transformation) covers connected inventory and store operations.
- [LankaPay's LANKAQR information](https://lankapay.net/en/for-financial/lanka-qr) describes Sri Lanka's QR payment network and participating-institution model. Actual technical access depends on the chosen provider.
