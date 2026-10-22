# ShopFlow

<img src="apps/web/public/brand/shopflow-preview.png" alt="ShopFlow logo" width="420" />

A store workspace for inventory, purchasing and cash checkout. Author and project owner: **tniketha**.

![ShopFlow store dashboard](docs/screenshots/01-dashboard-desktop.jpg)

Explore the [desktop and mobile screenshot gallery](docs/screenshots/README.md). Images show fictional sample store data. See the [portfolio notes](docs/PORTFOLIO.md) for suggested images and a short project description.

The retail interface pairs forest-green navigation with warm neutral surfaces, clear product prices and stock indicators. Real reference photographs are bundled for common grocery products. Owners and managers can choose a photo or upload their own through **Inventory → Edit → Product photo**. See [product photos, updating an existing database, and photography credits](docs/PHOTOS.md).

Reusable SVG and transparent PNG logos are included in the [brand assets](docs/BRAND.md). See the [proposed feature roadmap](docs/ROADMAP.md) for the next improvements.

ShopFlow uses TypeScript, Next.js 16 App Router, React 19, Tailwind CSS 4, Fastify 5, PostgreSQL and Prisma 7.10.1 with the PostgreSQL driver adapter. Dependency versions are recorded in `package-lock.json`. Prisma 7.10.1 is pinned as the stable release; the registry's Prisma 8 tag was a release candidate when this project was created.

## Start on Windows

Install **Node.js 22.14 or later in the 22.x line**, with npm. Internet access is needed for the first dependency installation. Use a normal Windows user account.

1. Put the project in `C:\Users\vishn\Desktop\NikkyProjects\ShopFlow` or any folder on your laptop.
2. Run **Setup.cmd**. Enter your display name, email, a password of at least 12 characters, and store name when asked. Password entry is masked. The setup creates a random local database password, generates Prisma, applies migrations and provisions your first owner.
3. Run **Start-Database.cmd** and keep its window open.
4. Run **Start-ShopFlow.cmd** and keep its window open.
5. Open **http://localhost:3000** and sign in with the credentials you chose.

Use `localhost:3000` consistently. The allowed request origin is configured in `.env`; switching to `127.0.0.1:3000` requires updating `APP_ORIGIN`. The local database listens only on `127.0.0.1:54329`. The API uses port 4000; the website uses port 3000 (`WEB_PORT` can override it).

Setup keeps an existing `.env` and existing accounts. It does not reset passwords or overwrite store data. Run setup with the database launcher closed; it temporarily starts and stops the database itself. Stop the website first, then use **Ctrl+C** in the database window for a clean shutdown.

There are no default credentials and no sample store data in the source distribution. Names in the dashboard come from the signed-in account; author attribution is confined to project metadata and documentation.

### Equivalent commands

```powershell
cd C:\Users\vishn\Desktop\NikkyProjects\ShopFlow
npm ci
node scripts/prepare-env.mjs
npm run db:generate
# Setup.cmd prompts securely for the initial owner information.
```

To use an installed or managed PostgreSQL service instead, copy `.env.example` to `.env`, supply your own connection URL, and run:

```powershell
npm ci
npm run db:generate
npm run db:migrate
# Supply OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD and BUSINESS_NAME as
# process environment variables, then run:
npm run owner:create
npm run dev
```

Do not leave `OWNER_PASSWORD` in a committed file. The local setup script passes it in process memory and removes it afterward. New businesses are created through the owner provisioning command, not public registration. User emails are globally unique for unambiguous sign-in.

## Transfer from this PC to your laptop

The Desktop folder is an independent app copy with **no Git metadata or GitHub remote**. The GitHub working copy is separate. Editing or moving the Desktop folder does not update GitHub automatically.

- **Code only:** close the app, cut and paste the complete project folder to your laptop, install Node.js 22, and run Setup.cmd. On a different OS or processor, reinstall dependencies with `npm ci` and regenerate Prisma. Build outputs and dependencies can be recreated.
- **Keep your local store data:** stop the app and database cleanly before moving. Preserve `.env` and `work/database` together, along with the source. These private files contain your database credentials and store records. The same bundled PostgreSQL major version is required for a direct data-folder move.
- **Safer transfer or a different PostgreSQL version:** use a PostgreSQL logical backup and restore as described in [TRANSFER.md](docs/TRANSFER.md). Do not move a live data directory.

The source ZIP intentionally excludes credentials, dependencies, database records and preview data. A source ZIP starts a fresh store when setup runs.

## Everyday workflow

1. **Inventory:** add categories and products. Prices and costs are entered in LKR, with at most two decimal places. New products have zero stock. Edit product details or archive products; archived products remain in historical transactions.
2. **Purchases:** create a supplier, choose products and quantities, then receive the purchase. This increases stock, records movements and updates the latest unit cost. Click category or supplier labels to edit; deletion is allowed only while the record is unused.
3. **Point of sale:** search by product name or SKU, add products, enter cash received and complete the sale. The server confirms current stock and prices. Download the PDF invoice after saving.
4. **Sales & refunds:** review sales and invoices. Owners and managers can return some or all unreturned units with a reason. A successful refund restores stock and records a separate cash-refund event. Physically return cash only after the operation succeeds.
5. **Reports:** select Sri Lanka business dates and view sales/refunds or a current stock valuation. Export CSV or PDF.
6. **Team:** owners create owner, manager and cashier accounts, and disable or enable non-owner accounts. Use the profile avatar to change your own password; this signs out all sessions.

If the connection fails during checkout, purchase receipt or a refund, use **Retry pending request**. The browser saves the original payload and request key in that user's session storage before sending it. The server replays a successful request and rejects the same key with changed data. Do not collect a second payment for a pending request. Pending state survives a page reload in the same browser tab; transaction history remains the recovery source if browser storage is cleared.

## Permissions

| Capability                                                 | OWNER | MANAGER | CASHIER |
| ---------------------------------------------------------- | ----- | ------- | ------- |
| Dashboard, product availability, checkout, sales, invoices | Yes   | Yes     | Yes     |
| Product costs, catalogue edits, purchasing, movements      | Yes   | Yes     | No      |
| Refunds, reports, exports, activity                        | Yes   | Yes     | No      |
| Create team accounts, enable/disable non-owners            | Yes   | No      | No      |
| Change own password                                        | Yes   | Yes     | Yes     |

Owner accounts cannot be disabled through the app. This prevents removing the last owner; owner recovery is an administrator procedure. Role changes and password resets for other accounts are not exposed as shortcuts.

## Data and correctness

- Every business record carries a server-derived `businessId`. Composite foreign keys prevent product/category, purchase/supplier, sale-line/product and refund-line relationships crossing business boundaries. API queries include the authenticated business; the browser cannot select one.
- Prices, costs, payments and transaction totals are **integer LKR cents** (`12345` means LKR 123.45). Decimal input is parsed as a string. Oversized transactions and inexact report arithmetic are rejected. The transaction limit is 2,000,000,000 cents (LKR 20,000,000.00).
- Checkout, receiving purchases and refunds use serializable database transactions with bounded retries. Stock is changed with conditional database updates, and transaction records, movements and activity entries commit together.
- A unique `(businessId, requestKey)` and payload hash protect purchases, sales and refunds from duplicates. An invoice number is assigned by a PostgreSQL sequence with a unique constraint. Numbers are globally unique, may have gaps, and are formatted as `SF-00000001`.
- Sale lines snapshot SKU, name, selling price and cost. Later catalogue edits do not alter the original sale value. Refunds use the original selling price and enforce cumulative returned quantities.
- PostgreSQL CHECK constraints reject negative stock, invalid quantities, over-returns and invalid monetary fields even if application validation is bypassed.
- Reports use Asia/Colombo date boundaries. Refunds reduce net sales on the refund date, including when the original sale was earlier. Timestamps in CSV are explicitly UTC. Current-stock reports use the latest received cost, not FIFO or weighted-average costing.
- List pages are paginated. Reports refuse more than 10,000 rows/events and date ranges over 366 days instead of silently truncating. Category/supplier lists are limited to 1,000, team lists to 200, recent purchases to 100, and the dashboard shows up to 20 low-stock items.

This version supports whole-unit inventory and cash payments. It does not implement card processing, offline checkout, tax rules, discounts, weighted goods, accounting ledgers or printer hardware. PDF invoices use built-in PDF fonts; validate non-Latin product names before adopting them for printed invoices. This is an operational store application, not a certified tax or accounting system.

## Verify and develop

```powershell
npm run db:generate
npm run typecheck
npm test
npm run test:integration
npm run build
```

Integration tests start an isolated **real PostgreSQL** instance, apply the SQL migrations, test the API and concurrent transactions, and shut it down. They do not use your store database. An optional `TEST_DATABASE_URL` must target a dedicated empty database ending in `_test`; tests truncate that database. Local tests create temporary files under `work/test-databases`; hosted Windows CI uses the runner's user-owned temporary folder so PostgreSQL can run with reduced privileges.

For schema changes, run `npm run db:dev -- --name your_change` against a development database. Review the generated migration and retain the hand-written CHECK constraints. Production and existing installations use `npm run db:migrate`, which runs `prisma migrate deploy` without resetting data. Regenerate the client after changing the schema.

See [PHASES.md](docs/PHASES.md) for implementation checkpoints, [API.md](docs/API.md) for REST routes and [DEPLOYMENT.md](docs/DEPLOYMENT.md) for hosting and CI/CD.

## Structure

```text
apps/api/       Fastify API, authentication, transaction services, Prisma, tests
apps/web/       Next.js App Router, React screens, Tailwind styling, API proxy
scripts/        Windows setup, environment preparation, frontend launcher
deploy/         Example Linux service and reverse-proxy configuration
.github/        Automated verification and manual deployment workflow
docs/           Architecture, migration, transfer, hosting and API guidance
work/           Private local database and temporary files (excluded from Git)
```

## Security and ownership

Sessions use random bearer tokens whose hashes are stored in PostgreSQL, HttpOnly cookies, absolute expiry, server-side revocation, origin checks and CSRF tokens for authenticated writes. Production cookies are Secure and host-only. Passwords use salted scrypt. API validation rejects unknown fields on writes. Permissions are enforced by the server, and unit costs are withheld from cashier responses. CSV exports escape spreadsheet formulas.

The in-memory rate limiter assumes a single API instance. Multiple replicas require a shared rate-limit store and deliberate trusted-proxy configuration. The local PostgreSQL user is for development; production needs separate migration and restricted runtime credentials. Public deployment requires HTTPS, backups and the configuration in the deployment guide.

Copyright © 2026 **tniketha**. All rights reserved. Third-party packages retain their respective licenses.
