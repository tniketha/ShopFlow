# Verification record

The implementation was checked locally on Windows with Node.js 22.14.0.

- `npm run db:generate`: Prisma 7.10.1 client generated successfully.
- Database migrations: all four migrations, including product photos and catalogue tools, applied successfully to a fresh real PostgreSQL 18.4 test database. The original setup was also checked twice to verify account preservation.
- `npm run typecheck`: API and web passed, including generation of Next.js route types for clean checkouts.
- `npm test`: 14 unit tests passed.
- `npm run test:integration`: 32 integration tests passed against real PostgreSQL (46 tests including unit tests). Coverage includes concurrent checkout/refund requests, duplicate replay, rollback, tenant isolation, CSRF and permissions. Photo checks cover atomic writes, isolation, cashier restrictions, corrupt/unsupported/oversized images, replacement and removal. Catalogue checks cover combined filters, stable pagination, per-account favourites, barcode uniqueness/isolation, CSV validation/rollback/concurrent retries and analytics day boundaries/refund events/snapshots/top-five limits.
- `npm run build`: API compilation and optimized Next.js production build passed.
- `npm audit --omit=dev --audit-level=high`: no vulnerabilities reported at verification time.
- Browser checks: sign-in, category creation, product creation, supplier creation, receipt of ten units, checkout at LKR 123.45 with LKR 200.00 cash and LKR 76.55 change, sales history and full refund succeeded. The refund disabled further returns of those units.
- Default visible author branding was removed. The welcome and profile use the authenticated account's display name.
- Photo browser checks: uploaded a real JPEG through the file chooser, saved it, reloaded the page and verified the private photo URL; switched it to a library photo and verified the result in checkout. All nine product photographs loaded successfully.
- Retail theme checks: desktop dashboard, inventory, checkout, reports, purchasing, sales and sign-in; mobile dashboard, checkout and photo editor. Basket photo thumbnails, selected-product quantities, stock indicators and exact LKR totals were checked. The screenshot gallery uses the updated retail theme and fictional store data.

Brand checks: API/web type checks and production build passed after adding the custom SVG logo. All logo/favicon/touch-icon URLs returned HTTP 200 with image content types. Browser checks confirmed icon metadata and readable desktop/mobile sign-in branding. SVG wordmarks use outlined lettering; PNG exports were visually reviewed.

Feature browser checks confirmed persistent personal favourites, combined filters, repeated 7/30-day chart switching and the full 30-day daily table. A stale-period render issue found during testing was fixed. Invalid CSV rows disabled import; a corrected two-row file imported with zero stock. Barcode entry rejected sold-out products and added available products to the basket. Keyboard entry was verified; physical USB scanner hardware was not available.

The current gallery contains nine desktop screenshots at 1440 × 1000 and three mobile screenshots at 390 × 844. Only one current capture per screen is retained; existing files were replaced in place.

The preview's temporary accounts, credentials and database are excluded from the source distribution and the independent Desktop app copy. Run Setup.cmd to create your own store and owner.

GitHub CI runs the checks on Windows and Linux. The original CI passed on both operating systems after placing the Windows runner's test database in its user-owned temporary directory. See the repository's Actions tab for the latest commit's status. The repository contains deployment configuration, but live hosting is not provisioned. PDF generation and export format checks passed; non-Latin font coverage and real-shop acceptance remain operational checks documented in README.md.
