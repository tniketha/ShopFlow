# ShopFlow

<img src="frontend/public/brand/shopflow-preview.png" alt="ShopFlow logo" width="420" />

A small full-stack shop application by **tniketha**. Manage products, receive stock, make cash sales and view sales history.

![ShopFlow dashboard](docs/screenshots/01-dashboard-desktop.jpg)

## Features

- **Overview:** today's sales, transaction count, product count, stock count and recent sales.
- **Inventory:** search, add, edit and archive products; manage categories. Product photos are included.
- **Purchases:** manage suppliers and receive stock at a stated unit cost.
- **Point of sale:** choose products, enter quantities and cash received, then save the sale.
- **Sales history:** view saved sale numbers, dates and totals.

Prices use LKR. New products start with zero stock. Purchases increase stock and sales decrease it. Completed sales keep their original names and prices.

## Stack and folders

JavaScript, Next.js App Router, React, Tailwind CSS, Node.js, Express and PostgreSQL. Queries use plain SQL through `pg`. Exact dependencies are in `package-lock.json`.

```text
frontend/     Screens, styling, logo, photos and API proxy
backend/
  src/        Express routes, authentication, SQL and business logic
  db/         SQL migrations
  test/       Unit and real-database tests
scripts/      Windows setup, startup and syntax-check helpers
docs/         Interview notes, asset credits and screenshots
.github/      Automated checks
```

Frontend and backend run separately. The browser calls the frontend's `/api` proxy, which forwards requests to Express. This keeps session cookies on one browser origin.

`node_modules` and `frontend/.next` are recreated by tools and excluded from source packages. After setup, `work/database` contains private local shop data. Never publish it.

## Run on Windows

Install Node.js 22.14 or later in the 22.x line, with npm. The first setup needs internet.

1. Put the project in `C:\Users\vishn\Desktop\NikkyProjects\ShopFlow`, or your preferred laptop folder.
2. Run **Setup.cmd**. Enter a store name, display name, email and password of at least 12 characters. Password entry is masked.
3. Run **Start-Database.cmd** and keep its window open.
4. Run **Start-ShopFlow.cmd** and keep its window open.
5. Open **http://localhost:3000** and sign in.

There are no default credentials or sample shop records. Setup installs dependencies, creates a local database, applies SQL migrations and creates your owner account. Existing accounts and passwords are retained. Product photos are bundled with the source.

Use `localhost:3000` consistently; `.env` defines the allowed origin. Express uses port 4000. The local database uses `127.0.0.1:54329`. Stop the app before stopping its database window with Ctrl+C.

To use your own empty PostgreSQL database, copy `.env.example` to `.env`, set the connection URL and run:

```powershell
npm ci
npm run db:migrate
# Set OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD and BUSINESS_NAME privately.
npm run owner:create
npm run dev
```

Keep credentials out of source. Windows setup passes owner details temporarily and removes them afterward. Never point setup at an unrelated database.

For separate development terminals, use `npm run dev -w @shopflow/backend` and `npm run dev -w @shopflow/frontend`.

For production, run `npm run build`, then run each workspace's `start` command. Production needs an HTTPS `APP_ORIGIN`, a private PostgreSQL connection and a reverse proxy serving the frontend securely. Keep Express private; the frontend proxy forwards requests. Use development mode for plain HTTP on a laptop.

## How it works

1. A React form sends a request through the Next.js API proxy.
2. Express checks the session, permissions and input.
3. Parameterized SQL reads or writes PostgreSQL records.
4. The response updates the screen.

`backend/src/trading.js` saves a purchase or checkout and its stock changes in one transaction. Failure rolls back. Checkout locks products in a consistent order, checks stock and saves price snapshots. A saved request key makes retries return the original result. After an uncertain response, use **Retry pending request**; do not collect cash twice.

Amounts are integer cents: `12345` means LKR 123.45. Decimal input is parsed as text to avoid floating-point rounding. Quantities are whole units. Sale numbers are unique and can have gaps.

Login uses hashed passwords and HttpOnly session cookies. Writes require the configured origin and a CSRF token. Product/purchase changes require owner or manager access. Cashier responses hide unit costs. Queries filter by the signed-in store. Database constraints protect stock, money and store relationships.

## Database changes

`backend/db/001-initial.sql` defines the tables. `npm run db:migrate` applies numbered SQL files in order and records checksums. Applied files are skipped. Matching existing ShopFlow tables can be recognized without changing accounts, products or sales; an incompatible schema stops setup instead of resetting data.

For future changes, add a numbered SQL file in `backend/db/`, review its effect and run `npm run db:migrate`. Never edit an applied migration. Back up store data before changing the database.

## Verify

```powershell
npm run check
npm test
npm run test:integration
npm run build
```

There are **13 unit tests and 20 real PostgreSQL integration tests**. They cover money, login, permissions, store boundaries, catalogue changes, purchases, stock limits, concurrent/repeated checkout, snapshots and SQL migrations. JavaScript syntax checks run before the frontend production build. CI runs on Windows and Linux.

Integration tests create a temporary PostgreSQL database. If you supply `TEST_DATABASE_URL`, it must name a dedicated database ending in `_test`: **tests rebuild its public schema**. Never use a real shop database for tests.

## Move to another laptop

The Desktop copy is independent, with no Git metadata or GitHub remote. GitHub work happens in a separate copy.

For a fresh install, move the source, install Node.js and run Setup.cmd. Dependencies/build output are recreated. To retain an existing store, stop it cleanly and keep `.env` and `work/database` together. Use a PostgreSQL logical backup across operating systems or database versions. Never publish credentials or database files.

[Interview guide](docs/PORTFOLIO.md) · [Screenshots](docs/screenshots/README.md) · [Asset credits](docs/ASSETS.md)

Copyright © 2026 **tniketha**. Third-party packages and photos retain their licenses.
