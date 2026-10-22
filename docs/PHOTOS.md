# Product photos

Inventory, checkout, the basket and low-stock alerts use the same product photo. Open **Inventory → Edit → Product photo** to choose a reference photo, upload an actual product photo, select automatic matching, or remove the image. Owners and managers can change photos; cashiers can view them.

Existing products automatically receive a reference photo when their name contains a recognized product type (rice, tea, milk, coffee, sugar, soap, biscuits/cookies, coconut oil, or drinking/mineral/spring water). Unrecognized products retain a neutral package icon. Reference photos show the product type, not the exact brand, pack size or packaging. Choose **No photo** to disable automatic matching for an item.

Uploads accept JPEG, PNG and WebP, up to 8 MB in the browser. The browser reduces them to at most 800 pixels, with a 512 KB server input limit. The API independently decodes and re-encodes the image as JPEG, strips original metadata, limits decoded pixels, rejects unsupported/corrupt images, and saves the photo in the same transaction as the product. A failed photo does not partially save the product. Photos are kept in PostgreSQL rather than a machine-specific folder and are included in database backups. Product listing responses include only the photo key/version, not the image bytes.

Uploaded images are served through an authenticated, business-scoped route with `Cache-Control: no-store`. Another store cannot read or change them. Replacing an upload with a library photo or removing the photo deletes the old bytes. Product changes retain the existing photo unless a replacement is supplied. Upload only photos you have permission to use.

## Existing installations

Back up your database, update the source, then run:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run build
```

The database must be running for migrations. The additive migration `202610220001_product_photos` preserves products, prices and stock. New installations receive this migration automatically through `Setup.cmd`.

## Bundled photography credits

The photos are real photographs downloaded from Pexels on 22 October 2026, resized by its image service and bundled in `apps/web/public/images`. They work without an external image request. The [Pexels License](https://www.pexels.com/license/) permits use in apps and websites, including commercial projects. These third-party photos retain their photographers' rights; ShopFlow's source authorship does not transfer those rights. Do not redistribute them as a standalone stock-photo collection or imply photographer/brand endorsement.

| Asset          | Photographer         | Source                                                                                                      |
| -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rice           | Waskyria Miranda     | [Bowl of raw rice](https://www.pexels.com/photo/bowl-of-raw-rice-on-a-white-background-31555433/)           |
| Tea            | Anna Pou             | [Dried leaves and tea](https://www.pexels.com/photo/containers-with-dried-leaves-and-a-cup-of-tea-8329979/) |
| Milk           | Charlotte May        | [Bottle and glass of milk](https://www.pexels.com/photo/bottle-and-glass-of-milk-on-desk-5946733/)          |
| Coffee         | Anna Tarazevich      | [Coffee beans in a bowl](https://www.pexels.com/photo/coffee-beans-in-a-bowl-5211535/)                      |
| Sugar          | Eva Bronzini         | [Sugar crystals](https://www.pexels.com/photo/a-close-up-shot-of-sugar-crystals-5988340/)                   |
| Soap           | Sydnee More          | [Organic soap](https://www.pexels.com/photo/close-up-of-organic-soap-bar-on-white-background-6958981/)      |
| Biscuits       | MPC Fotografia       | [Filled cookies](https://www.pexels.com/photo/stacks-of-cookies-on-white-surface-5241510/)                  |
| Coconut oil    | Daniela Elena Tentis | [Coconut oil in a jar](https://www.pexels.com/photo/clear-glass-container-with-coconut-oil-725998/)         |
| Water          | Engin Akyurt         | [Glass of water](https://www.pexels.com/photo/clear-drinking-glass-with-clear-liquid-10965842/)             |
| Shop / sign-in | Matheus Cenali       | [Vegetables on supermarket shelves](https://www.pexels.com/photo/assorted-vegetable-lot-2733918/)           |
