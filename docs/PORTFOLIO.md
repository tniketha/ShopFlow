# ShopFlow portfolio notes

## Short project description

ShopFlow is a full-stack retail workspace for inventory, purchasing, cash checkout, refunds and reporting. It combines a responsive Next.js interface with a Fastify REST API and PostgreSQL, with role-based access, exact LKR arithmetic and transaction-safe stock management.

Author and project owner: **tniketha**.

## Suggested showcase sequence

1. **Dashboard** — use `screenshots/01-dashboard-desktop.jpg` as the cover image.
2. **Checkout** — use `screenshots/03-pos-desktop.jpg` to show the primary store workflow.
3. **Inventory** — use `screenshots/02-inventory-desktop.jpg` for catalogue and stock management.
4. **Reports** — use `screenshots/04-reports-desktop.jpg` for reporting and exports.
5. **Responsive views** — use the two mobile screenshots to show the narrow layout.

The [complete screenshot gallery](screenshots/README.md) also includes purchasing, sales history, sign-in and the product photo editor.

## Technical points to explain

- **Stack:** TypeScript, Next.js App Router, React, Tailwind CSS, Fastify, PostgreSQL and Prisma.
- **Checkout correctness:** serializable transactions, conditional stock updates, unique invoice numbers and duplicate-request protection.
- **Refund correctness:** original sale-price snapshots, cumulative return limits and atomic stock restoration.
- **Business isolation:** server-derived business identity and composite database foreign keys.
- **Authentication:** HttpOnly session cookies, hashed session tokens, CSRF protection, session revocation and owner/manager/cashier permissions.
- **Money:** integer LKR cents with decimal-string parsing and bounds checks.
- **Product photography:** bundled real reference photos, optional private photo uploads, image validation, metadata removal and business-scoped access.
- **Retail design:** forest-green navigation, warm neutral surfaces, photo-led product cards, clear LKR prices and stock status, with responsive desktop and mobile layouts.
- **Verification:** 14 unit tests and 22 real PostgreSQL integration tests, including concurrent operations and photo isolation. GitHub CI verifies Windows and Linux.

Repository: [github.com/tniketha/ShopFlow](https://github.com/tniketha/ShopFlow).

The screenshots show fictional data from a local preview. Describe this as a local full-stack project until you configure and verify live hosting; do not label the repository link as a live demo. Deployment configuration and a manually triggered deployment workflow are included, while hosting still needs credentials and configuration.
