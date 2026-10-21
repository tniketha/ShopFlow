# Implementation checkpoints

Author: tniketha

| Phase          | Implemented                                                                                                                                                                                 | Verification                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — foundation | npm workspace, environment example, Windows setup, PostgreSQL launcher, Prisma schema/migrations, owner provisioning, login/logout, session expiry, CSRF, roles, dashboard                  | TypeScript; auth, origin, session rotation, expiry, disabled-account and RBAC integration tests                                                               |
| 2 — inventory  | Products with categories, suppliers, editable catalogue, product archival, multi-line purchase receipt, stock movements, low-stock dashboard                                                | Real PostgreSQL purchase replay and rollback tests; cross-business reference checks; browser category/product/supplier/purchase flow                          |
| 3 — checkout   | Cash POS, serializable transactions, conditional stock updates, unique invoice sequence, price/cost snapshots, PDF invoices, partial refunds and stock restoration, persistent request keys | Simultaneous last-unit checkout, simultaneous duplicate checkout, payment rollback, snapshot, duplicate refund and concurrent over-refund tests; browser sale |
| 4 — reporting  | Daily dashboard, sales/refund reports by business date, current stock valuation, CSV/PDF exports, activity history                                                                          | Sri Lanka midnight boundary, separately dated refunds, PDF signature and CSV formula-escaping tests                                                           |
| 5 — delivery   | Unit/integration tests, production build, security controls, Windows/Linux CI, manually triggered deployment-hook workflow, service examples, README, transfer/backup guidance              | Local test and build commands; dependency audit. Hosted CI/CD execution needs the repository push and hosting configuration.                                  |

## Design choices

The Next.js application proxies the REST API under `/api`, keeping browser requests on one origin. Fastify owns authentication and all permissions. PostgreSQL owns the transactional invariants; Prisma's pg driver adapter supports the stable Prisma 7 client.

Each authenticated identity belongs to one business. No tenant ID is accepted in ordinary request bodies. Both query scoping and composite foreign keys protect relationships. Authentication records are separate from business data.

Stock is an integer projection backed by append-only purchase, sale and refund movements. Normal clients cannot directly set stock or rewrite completed sales. Archived products preserve references and can still receive legitimate returns.

Purchases, sales and refunds have independent idempotency keys scoped to a business. Data is normalized before hashing. A failed transaction leaves neither a stock movement nor a partial invoice. Sequence gaps are expected after rolled-back transactions.

## Remaining operational work

- Choose real hosting and a production database; supply the HTTPS origin and runtime credentials.
- Set the repository's production environment approval rules and deploy-hook secret if using the manual deployment workflow.
- Validate the app with the shop's real product data and invoice language, and perform a restore drill before live use.
- Add a shared limiter before running multiple API instances. Add pagination/search for unusually large category, supplier or team lists.
- Card payments, tax calculations, discounts, barcode printer integrations and offline operation are separate future features.

These are explicit scope boundaries. A passing local build does not claim a live deployment or completed hosted CI run.
