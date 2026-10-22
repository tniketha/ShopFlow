# ShopFlow feature scope

The five simple portfolio improvements are implemented:

| Feature           | Available now                                                       |
| ----------------- | ------------------------------------------------------------------- |
| Product discovery | Combined category/stock filters, search and sorting                 |
| Sales insights    | 7/30-day net-sales chart, exact daily figures and top five products |
| Favourites        | Personal saved products in inventory, purchasing and checkout       |
| CSV import        | Template, row-level preview, atomic import and safe retries         |
| Barcode checkout  | Optional unique product codes, keyboard/USB-scanner entry           |

See [FEATURES.md](FEATURES.md) for setup, permissions and everyday use. These features demonstrate React state, API design, database constraints, exact currency handling and automated concurrency tests while keeping the workflow understandable.

Possible small follow-ups are keyboard shortcuts with on-screen help, saved report-date presets and clearer first-use guidance for an empty store. These are proposals, not implemented features. Choose one after trying the current app with shop staff.

Camera scanning, barcode-label printing, loyalty programmes, expiry batches, online ordering and payment-provider integrations remain outside the current scope. Add them when there is a concrete store requirement.
