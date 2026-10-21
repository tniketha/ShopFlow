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
  "categoryId": null
}
```

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
