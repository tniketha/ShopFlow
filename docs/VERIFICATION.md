# Verification record

The implementation was checked locally on Windows with Node.js 22.14.0.

- `npm run db:generate`: Prisma 7.10.1 client generated successfully.
- `npm run db:migrate`: both SQL migrations applied to a fresh real PostgreSQL 18.4 database. A second setup run reported no pending migrations and retained existing accounts.
- `npm run typecheck`: API and web passed, including generation of Next.js route types for clean checkouts.
- `npm test`: 14 unit tests passed.
- `npm run test:integration`: 18 integration tests passed against real PostgreSQL, including concurrent checkout/refund requests, duplicate replay, transaction rollback, tenant isolation, CSRF and permissions.
- `npm run build`: API compilation and optimized Next.js production build passed.
- `npm audit --omit=dev --audit-level=high`: no vulnerabilities reported at verification time.
- Browser checks: sign-in, category creation, product creation, supplier creation, receipt of ten units, checkout at LKR 123.45 with LKR 200.00 cash and LKR 76.55 change, sales history and full refund succeeded. The refund disabled further returns of those units.
- Default visible author branding was removed. The welcome and profile use the authenticated account's display name.

The preview's temporary accounts, credentials and database are excluded from the source distribution and the independent Desktop app copy. Run Setup.cmd to create your own store and owner.

GitHub CI passed on both Windows and Linux after placing the Windows runner's test database in its user-owned temporary directory. See the repository's Actions tab for the latest commit's status. The repository contains deployment configuration, but live hosting is not provisioned. PDF generation and export format checks passed; non-Latin font coverage and real-shop acceptance remain operational checks documented in README.md.
