# Verification record

The implementation was checked locally on Windows with Node.js 22.14.0.

- `npm run db:generate`: Prisma 7.10.1 client generated successfully.
- Database migrations: the original two migrations and the additive product-photo migration applied successfully to a fresh real PostgreSQL 18.4 test database. The original setup was also checked twice to verify account preservation.
- `npm run typecheck`: API and web passed, including generation of Next.js route types for clean checkouts.
- `npm test`: 14 unit tests passed.
- `npm run test:integration`: 22 integration tests passed against real PostgreSQL, including concurrent checkout/refund requests, duplicate replay, transaction rollback, tenant isolation, CSRF and permissions. Photo checks cover atomic creation/update, business isolation, cashier restrictions, corrupt/unsupported/oversized images, replacement and removal.
- `npm run build`: API compilation and optimized Next.js production build passed.
- `npm audit --omit=dev --audit-level=high`: no vulnerabilities reported at verification time.
- Browser checks: sign-in, category creation, product creation, supplier creation, receipt of ten units, checkout at LKR 123.45 with LKR 200.00 cash and LKR 76.55 change, sales history and full refund succeeded. The refund disabled further returns of those units.
- Default visible author branding was removed. The welcome and profile use the authenticated account's display name.
- Photo browser checks: uploaded a real JPEG through the file chooser, saved it, reloaded the page and verified the private photo URL; switched it to a library photo and verified the result in checkout. All nine product photographs loaded successfully.
- Retail theme checks: desktop dashboard, inventory, checkout, reports, purchasing, sales and sign-in; mobile dashboard, checkout and photo editor. Basket photo thumbnails, selected-product quantities, stock indicators and exact LKR totals were checked. The screenshot gallery uses the updated retail theme and fictional store data.

The preview's temporary accounts, credentials and database are excluded from the source distribution and the independent Desktop app copy. Run Setup.cmd to create your own store and owner.

GitHub CI runs the checks on Windows and Linux. The original CI passed on both operating systems after placing the Windows runner's test database in its user-owned temporary directory. See the repository's Actions tab for the latest commit's status. The repository contains deployment configuration, but live hosting is not provisioned. PDF generation and export format checks passed; non-Latin font coverage and real-shop acceptance remain operational checks documented in README.md.
