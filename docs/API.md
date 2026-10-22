# REST API

All routes are on Fastify at port 4000. The browser uses the same routes through Next.js under `/api`. JSON responses and authenticated downloads are marked `no-store`. Errors return `{ "error": "message" }`; invalid fields may include a `details` list.

`POST`, `PATCH` and `DELETE` require the configured `Origin`. Authenticated writes additionally require the `X-CSRF-Token` returned by login or `/auth/me` and the session cookie. All business IDs come from the session.

| Method        | Route                                                           | Permission / purpose                                                 |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET           | `/health`                                                       | Database readiness                                                   |
| POST          | `/auth/login`                                                   | Email/password → session cookie and CSRF token                       |
| GET           | `/auth/me`                                                      | Current account, store name and CSRF token                           |
| POST          | `/auth/logout`                                                  | Revoke current session                                               |
| POST          | `/auth/password`                                                | Current/new password; revokes all own sessions                       |
| GET           | `/dashboard`                                                    | Daily sales totals and low-stock products                            |
| GET           | `/products?page=1&search=tea`                                   | Paginated active products; cashier costs omitted                     |
| GET           | `/products/lookup?barcode=8901234567890`                        | Exact active barcode in the current store; cashier costs omitted     |
| PATCH         | `/products/:id/favourite`                                       | Any signed-in role: set own favourite with `{ "favourite": true }`   |
| POST          | `/products/import/preview`                                      | Owner/manager: validate `{ "csv": "..." }` without writes            |
| POST          | `/products/import`                                              | Owner/manager: atomic `{ "csv": "...", "requestKey": "<UUID>" }`     |
| GET           | `/analytics/sales?days=7`                                       | Owner/manager: daily net sales and top five; days must be 7 or 30    |
| GET           | `/products/:id/photo`                                           | Authenticated JPEG in the current business; no-store                 |
| POST          | `/products`                                                     | Owner/manager: create with zero stock                                |
| PATCH         | `/products/:id`                                                 | Owner/manager: catalogue fields / active flag; stock is not writable |
| GET, POST     | `/categories`                                                   | Read / owner-manager create                                          |
| PATCH, DELETE | `/categories/:id`                                               | Owner/manager; delete unused records only                            |
| GET, POST     | `/suppliers`                                                    | Read / owner-manager create                                          |
| PATCH, DELETE | `/suppliers/:id`                                                | Owner/manager; delete unused records only                            |
| GET, POST     | `/purchases`                                                    | Owner/manager: recent purchases / atomic receipt                     |
| GET           | `/movements?page=1`                                             | Owner/manager: stock movement history                                |
| GET, POST     | `/sales`                                                        | Paginated sale history / atomic cash checkout                        |
| GET           | `/sales/:id/invoice.pdf`                                        | PDF invoice in the current business                                  |
| POST          | `/sales/:id/refunds`                                            | Owner/manager: partial/full cash refund                              |
| GET           | `/reports?from=2026-10-01&to=2026-10-21&kind=sales&format=json` | Owner/manager: sales or stock report; format json/csv/pdf            |
| GET, POST     | `/users`                                                        | Owner: team list / account creation                                  |
| PATCH         | `/users/:id`                                                    | Owner: `{ "active": false }`; non-owner accounts only                |
| GET           | `/audit?page=1`                                                 | Owner/manager: activity history                                      |

## JSON examples

All request keys and record IDs below are UUIDs. Supply real IDs returned by your store; do not reuse the illustrative placeholders.

Product:

```json
{
  "sku": "TEA-100",
  "name": "Tea 100g",
  "priceMinor": 12345,
  "costMinor": 7000,
  "reorderLevel": 5,
  "categoryId": null,
  "barcode": "8901234567890",
  "photo": { "kind": "library", "key": "tea" }
}
```

`photo` is optional on product creation and update. Omission retains the current photo. Choices are `{ "kind": "automatic" }`, `{ "kind": "none" }`, `{ "kind": "library", "key": "tea" }`, or `{ "kind": "upload", "data": "data:image/jpeg;base64,..." }`. Library keys: `rice`, `tea`, `milk`, `coffee`, `sugar`, `soap`, `biscuits`, `oil`, `water`. Uploads also accept PNG/WebP data URLs, with a 512 KB decoded input limit and 20 million pixel limit; the API re-encodes accepted pixels as JPEG. Product write routes have a 768 KB JSON body limit; other routes retain 128 KB. Photo changes and product changes are atomic and share catalogue permissions. Responses include `photoKey` and `photoVersion`, with image bytes fetched separately. See [PHOTOS.md](PHOTOS.md) for storage and backup details.

`barcode` is optional, nullable, case-sensitive and unique within the store (including archived products). It accepts 1–64 letters/digits or `. _ / -`. Omission preserves the existing value on update; null removes it.

Product lists accept `page`, `search`, `categoryId` (UUID or `uncategorized`), `stock` (`all`, `in_stock`, `low`, `out`), `sort` (`name-asc`, `name-desc`, `price-asc`, `price-desc`, `stock-asc`, `stock-desc`) and `favourites` (`true`/`false`). Filters combine; each page has at most 50 rows with stable ID tie-breaking. Responses include the current user's `isFavourite`, never another user's favourite records. Low stock excludes zero quantities.

CSV routes accept up to 512 KB of UTF-8 CSV and 500 rows in a 1 MB JSON body. Required headers are `sku,name,price,cost`; optional headers are `reorderLevel,category,barcode`. Prices/costs use LKR decimal strings. Preview returns rows with values/errors, total and valid counts. Import revalidates, creates products at zero stock and records the request key/hash in one transaction. Any invalid row rolls back the batch. A successful retry returns its original count; changed data with the same key returns 409. Preview is limited to 15 requests/minute and commit to 10. See [FEATURES.md](FEATURES.md).

Analytics returns `days`, `from`, `to`, `daily` (date, grossMinor, refundMinor, netMinor, transactions), `summary`, and `topProducts` (productId, name, units, revenueMinor). Dates use Colombo business boundaries, with zero-filled days and refund-date net accounting. Top products rank by units sold before returns using historical sale snapshots; they contain no costs.

Purchase receipt:

```json
{
  "requestKey": "<new UUID>",
  "supplierId": "<supplier UUID>",
  "lines": [{ "productId": "<product UUID>", "quantity": 10, "costMinor": 7000 }]
}
```

Checkout:

```json
{
  "requestKey": "<new UUID>",
  "paidMinor": 20000,
  "lines": [{ "productId": "<product UUID>", "quantity": 1 }]
}
```

The client cannot supply a checkout price or total. Retry a timed-out request with exactly the same key and payload. A replay returns the existing record. Changed payload with the same key returns HTTP 409.

Refund:

```json
{
  "requestKey": "<new UUID>",
  "reason": "Customer returned unopened item",
  "lines": [{ "saleLineId": "<sale line UUID>", "quantity": 1 }]
}
```

Use one line per product or sale line; duplicates are rejected. Quantities are whole numbers, 1–100,000 per line, with at most 100 lines. Money values are integer cents and each transaction total is capped at 2,000,000,000 cents.
