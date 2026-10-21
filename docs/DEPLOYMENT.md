# Hosting and CI/CD

The source includes GitHub Actions verification on Windows and Linux. It runs installation, Prisma generation, TypeScript checks, unit tests, real PostgreSQL integration tests, the production build and a production-dependency audit. No hosting credentials are included.

## Build and run

Use Node.js 22.14+ (22.x) and a maintained PostgreSQL service. Provision a separate migration identity with DDL rights and a runtime identity with only the required SELECT/INSERT/UPDATE/DELETE/sequence permissions. Do not use the local development superuser in production.

Supply these environment values through your host's secret manager or a private `.env` file:

```text
DATABASE_URL=postgresql://<runtime user>:<password>@<database host>/shopflow?sslmode=verify-full
APP_ORIGIN=https://shopflow.example.com
API_INTERNAL_URL=http://127.0.0.1:4000
PORT=4000
WEB_PORT=3000
HOST=127.0.0.1
NODE_ENV=production
SESSION_DAYS=7
```

Use your provider's documented TLS URL and trusted CA configuration. Do not disable certificate verification. Use the migration identity only while running `npm run db:migrate`; switch back to the runtime URL before starting the services.

```text
npm ci
npm run db:generate
npm run typecheck
npm test
npm run test:integration
npm run build
npm run db:migrate
npm run start -w @shopflow/api
npm run start -w @shopflow/web
```

Run the two start commands as separate managed processes. Provision the first owner once with the owner-create command and process environment variables; remove provisioning secrets afterward. The website is the public entry point. Keep the API and database private, and terminate HTTPS at a trusted reverse proxy. `APP_ORIGIN` must exactly match the public HTTPS origin. Production uses a Secure `__Host-shopflow` cookie, so plain HTTP login will not work.

Example systemd units and an nginx server block are under `deploy/`. Replace the hostname, certificate paths and installation path. Create an unprivileged `shopflow` service user and make the source readable to that user. Protect `.env` with owner-only permissions. Node/npm paths vary by installation; verify the paths in the unit files.

Health checks: the website should return HTTP 200, `/api/health` should return `{ "status": "ok" }`, and an unauthenticated `/api/products` should return HTTP 401. Before going live, sign in through HTTPS, make a controlled test purchase and sale, verify the invoice, test a refund and restore a backup into an isolated database.

## Optional manual deployment workflow

The `Deploy ShopFlow` workflow is manually triggered from GitHub Actions. It verifies the source before calling a configured hosting provider's deploy-hook URL. Add the provider's hook as the **production environment secret `DEPLOY_HOOK_URL`** and configure required reviewers for that environment if desired. Never put the hook in source or workflow output.

The hosting service must independently pull this repository, build the requested commit, run migrations and restart both services. A successful hook request confirms only that the host accepted the trigger; confirm completion on the host before considering a deployment live. No live hosting is provisioned by this repository.

## Operations

- Schedule encrypted PostgreSQL backups and regularly test restoration. See TRANSFER.md. Define retention and access according to the store's needs.
- Keep dependency updates behind the same tests; inspect release notes before a Prisma or PostgreSQL major upgrade.
- Run one API instance with the current in-memory limiter. Multiple replicas require shared rate-limit storage. The Next proxy does not trust client-supplied IP forwarding headers; add trusted-proxy handling and edge rate limiting deliberately when deploying behind a proxy.
- The login limiter is intentionally strict and shares the app proxy's source IP. Put additional per-client limits at the reverse proxy when serving multiple operators.
- Use log rotation. Logs must not contain request bodies, passwords, cookies or raw session tokens.
- Apply backward-compatible migrations before deploying new code. Back up first. Rolling application code back does not undo a migration; write a reviewed forward repair when necessary.
- Invoice numbers are global and may have gaps. Preserve the sequence during restores. Validate invoice wording, language and any required local tax fields before actual business use.
