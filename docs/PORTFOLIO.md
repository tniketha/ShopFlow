# ShopFlow interview guide

Author: **tniketha**.

ShopFlow is an inventory and cash-sales application. The frontend uses JavaScript, React and Next.js. A separate Node.js/Express backend reads and writes PostgreSQL using parameterized SQL through `pg`.

## Five-minute demo

1. Sign in and open Overview.
2. Add a category and product. A new product has zero stock.
3. Add a supplier and receive a purchase.
4. Select the product in Point of sale, enter cash received and save.
5. Show the updated stock and saved sales history.

## Files to understand

| File                                    | Responsibility                               |
| --------------------------------------- | -------------------------------------------- |
| `frontend/components/workspace.jsx`     | React state, forms and the five screens      |
| `frontend/components/product-photo.jsx` | Match product names to bundled photos        |
| `frontend/app/api/[...path]/route.js`   | Forward browser requests to the backend      |
| `backend/src/app.js`                    | Express middleware, routes and safe errors   |
| `backend/src/auth.js`                   | Login, sessions and permissions              |
| `backend/src/catalogue.js`              | Product, category and supplier routes        |
| `backend/src/sales.js`                  | Purchase/sale routes and overview totals     |
| `backend/src/trading.js`                | Receive stock and save cash sales atomically |
| `backend/src/db.js`                     | PostgreSQL connections and transactions      |
| `backend/src/domain.js`                 | Amounts, passwords and input validation      |
| `backend/db/001-initial.sql`            | Tables, indexes and database constraints     |
| `backend/test/`                         | Unit and real-database tests                 |

Explain a form submission from React through Express to PostgreSQL. Explain why amounts use integer cents, why stock changes and sales save together, and why a retry must reuse its request key. Show how SQL parameters keep input separate from the query itself.

Installed libraries and generated build files are not application code you need to walk through. Explain the parts you understand and the choices you made. Test commands are in the main README.

The [screenshot gallery](screenshots/README.md) contains fictional sample data. The repository is a source-code link, not a live deployment: [tniketha/ShopFlow](https://github.com/tniketha/ShopFlow).
