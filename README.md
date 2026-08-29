# ThePhoneSearch eBay Integration

Production-oriented MobileParts.shop / 2Service → eBay seller manager. The project is intentionally operating in preview/safety mode while catalog, pricing, shipping, listing content and order workflows are validated.

## One project, three runtimes

- **Dashboard and API (Vercel):** seller interface, eBay OAuth, market comparison, pricing, order previews and automatic listing enrichment.
- **Catalogue monitor (Cloudflare Worker + D1):** resumable supplier import, stock history, review storage, background queues and safe eBay stock deltas.
- **Source and deployment (GitHub):** the complete project is versioned in `Barakahtags/thephonesearch-ebay`; pushes deploy the Vercel app and the Worker through their existing workflows.

The importer advances three supplier pages per scheduled run with one renewable lease and small D1 batches. Automatic listing enrichment handles 20 products per server batch. The browser never starts its own duplicate AI loop, so closing the dashboard does not stop processing and leaving it open does not waste Cloudflare requests.

## Implemented

- eBay production OAuth connectivity with refresh-token support.
- eBay business-policy and inventory-location discovery.
- MobileParts authentication, paginated catalog retrieval, part lookup, stock and product data.
- Device/brand/model/part catalogue browser.
- Listing preview with supplier title, optimized title, description, images, SKU and stock.
- AI listing content when configured, with deterministic built-in optimizer fallback.
- Profit engine with a 30% minimum net-margin floor.
- Germany dropship economics: MobileParts shipping cost €8.40 per customer shipment; buyer-facing Germany shipping €4.99; the remainder is recovered through item pricing.
- eBay fee assumptions currently configured by the project: 11% product fee + 19% VAT on that fee, €0.35 fixed fee, 10% fee on charged shipping + 19% VAT on that shipping fee.
- Competitor pricing layer compares total buyer cost (item + shipping), not item price alone, and never recommends below the margin floor.
- Combined-shipping fulfillment-policy setup: Germany €4.99 first shipment charge and €0 additional eligible-item shipping. EU support is built but stays disabled until real MobileParts EU supplier/customer rates are configured.
- eBay order preview and supplier SKU/stock validation.
- Guarded MobileParts basket preparation from paid eBay orders.
- MobileParts tracking lookup and optional eBay shipping-fulfillment write with duplicate-tracking protection.
- Dark 4K-oriented seller dashboard.

## Important financial safety design

Supplier purchasing is MANUAL by design at this stage. The application prepares the exact MobileParts basket lines and customer delivery address, but it does not submit a supplier purchase automatically. This prevents duplicate supplier orders caused by retries/timeouts while no durable idempotency database is installed.

After the operator checks out once on MobileParts, the returned supplier order number can be supplied to `/api/order-automation`. The app can then retrieve supplier tracking. eBay tracking writes remain separately locked behind `EBAY_AUTO_TRACKING=true`.

This matches the desired operating model: eBay order → validated MobileParts basket → manual supplier payment/checkout → supplier order number → tracking lookup → eBay fulfillment update.

## Safety locks

- All eBay write paths are enforced by `api/_lib/live-control.js`; confirmation text alone cannot bypass SAFE mode.
- `TPS_LIVE_MASTER=false` — master server-side lock. `SYNC_MODE=live` must also be set before any live capability can arm.
- Separate capability locks: `TPS_LIVE_LISTINGS`, `TPS_LIVE_STOCK_PRICE_SYNC`, `TPS_LIVE_TRACKING`, and `TPS_LIVE_SHIPPING_POLICY`.
- `SYNC_MODE=preview` — default; no live inventory/offer sync.
- `EBAY_PUBLISH=false` — default; offers are not published.
- `EBAY_AUTO_TRACKING=false` — recommended until tracking flow is tested end-to-end.
- Supplier auto-purchase is not exposed; manual checkout remains mandatory until durable idempotency storage is implemented.

The dashboard reports the centralized capability state. Interactive activation is intentionally unavailable until a durable runtime settings store and audit log are installed; serverless process memory is not treated as persistence.

## Required secrets/config

Core: `MPS_USERNAME`, `MPS_PASSWORD`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `ADMIN_TOKEN`.

Marketplace/listing: `EBAY_MARKETPLACE_ID` (default `EBAY_DE`), `EBAY_CURRENCY` (default `EUR`), `EBAY_DEFAULT_CATEGORY_ID`, `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_NAME` (default `mobileparts`), `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`. Every offer must resolve the named fulfillment profile; publishing stops safely if it is missing.

Pricing/shipping: `MIN_NET_MARGIN` (30), `EBAY_PRODUCT_FEE_RATE` (.11), `EBAY_SHIPPING_FEE_RATE` (.10), `EBAY_FEE_VAT_RATE` (.19), `EBAY_FIXED_FEE` (.35), `MPS_SHIPPING_DE` (8.40), `EBAY_CUSTOMER_SHIPPING_DE` (4.99). Shipping is Germany-only through the `mobileparts` profile until verified international rates are configured; EU/worldwide delivery must remain disabled in that eBay profile until then.

## Main API routes

- `GET /api/status` — protected configuration/connectivity check.
- `GET /api/catalog` and `/api/catalog-all` — protected MobileParts catalog.
- `GET /api/sync-preview?limit=25` — protected listing/pricing preview.
- `POST /api/sync` — live inventory/offer sync, safety-locked.
- `GET /api/orders-preview` — protected eBay order preview.
- `POST /api/setup-shipping` — create/update ThePhoneSearch combined shipping policy.
- `POST /api/order-automation` with `orderId` — validate paid order and return MobileParts basket/address data.
- `POST /api/order-automation` with `orderId` + `supplierOrderNumber` — retrieve MobileParts tracking and, only when enabled, send shipping fulfillment to eBay.

Protected routes require `x-admin-token`.

## Before live launch

1. Configure and verify the real EU supplier shipping rate and desired EU customer shipping charge.
2. Verify the generated eBay fulfillment policy in the seller account.
3. Review category-specific eBay fee assumptions before mass publishing.
4. Test several real-world order shapes in preview, including multi-line orders and quantity >1.
5. Keep publishing off until the eBay shop/subscription and listing limits are ready.
6. Add durable database storage before any future unattended supplier purchasing.
7. Package the manager as the final desktop application after the web/API workflow is stable.
