# ThePhoneSearch eBay Integration

Production integration between MobileParts.shop / 2Service and eBay.

## What is implemented

- eBay production OAuth connectivity and optional automatic refresh-token support.
- eBay marketplace account-policy discovery.
- eBay inventory-location discovery.
- MobileParts.shop authentication and paginated catalog retrieval.
- Supplier stock, price, EAN, manufacturer and image mapping.
- Dry-run eBay listing preview with category suggestions.
- Live inventory/offer upsert behind an explicit `SYNC_MODE=live` safety lock.
- Optional offer publishing behind a separate `EBAY_PUBLISH=true` lock.
- eBay order preview for dropship preparation.
- Admin dashboard at `/dashboard.html`.
- Marketplace Account Deletion endpoint retained for eBay compliance.

## Required Vercel secrets/config

Already present in the current project: `EBAY_USER_TOKEN`, `EBAY_VERIFICATION_TOKEN`.

For MobileParts.shop: `MPS_USERNAME`, `MPS_PASSWORD`.

For permanent eBay OAuth (recommended because `EBAY_USER_TOKEN` expires quickly): `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`. `EBAY_CLIENT_ID` is optional because the current production client ID is the code default, but setting it explicitly is recommended.

Optional listing settings: `EBAY_MARKETPLACE_ID` (default `EBAY_DE`), `EBAY_CURRENCY` (default `EUR`), `EBAY_SITE_ID`, `EBAY_DEFAULT_CATEGORY_ID`, `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `PRICE_VAT_RATE` (default `0.19`), `PRICE_MARKUP_PERCENT` (default `25`), `PRICE_FIXED_ADD` (default `0`).

Safety locks: `SYNC_MODE=preview` by default. Set `SYNC_MODE=live` only after checking `/api/sync-preview`. `EBAY_PUBLISH=false` by default; set true only when offers should actually be published.

`ADMIN_TOKEN` is recommended. If absent, admin endpoints use the existing `EBAY_VERIFICATION_TOKEN` as the admin header secret.

## API routes

- `/api/ebay-test` public non-sensitive eBay connection test.
- `/api/status` protected full configuration/connectivity check.
- `/api/catalog?pageSize=25&page=1` protected MobileParts catalog preview.
- `/api/sync-preview?limit=10` protected end-to-end listing preview.
- `/api/sync?limit=5&page=1` protected POST-only live inventory/offer sync; locked unless `SYNC_MODE=live`.
- `/api/orders-preview` protected eBay order preview.

Protected routes require `x-admin-token`.

## Dropship ordering

The 2Service API supports placing dropship orders and this repository includes the supplier client method. Automatic order placement is deliberately not enabled yet because a durable idempotency store is required to guarantee that a retry cannot create the same supplier order twice. Order preview is implemented and safe. Add a persistent store before enabling unattended ordering.

## API sources

MobileParts.shop points developers to the 2Service Swagger service at `https://services.2service.nl/swagger-ui/`, with the OpenAPI document at `https://services.2service.nl/openapi`.
