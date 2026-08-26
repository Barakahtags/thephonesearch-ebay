# ThePhoneSearch / MobileParts -> eBay — ChatGPT Handover

Updated: 26 August 2026

## READ THIS FIRST
This file exists so a fresh ChatGPT conversation can continue this project without making the user explain it again. Before changing code, inspect the repository and verify the current deployment/runtime state. Do not assume an old chat statement means a feature is live.

The user wants ChatGPT to work proactively: do not stop after every tiny step asking permission. Work through sensible non-destructive development steps and report consolidated progress. Never silently enable money-moving or public-publishing actions.

## Project
Repository: Barakahtags/thephonesearch-ebay
Product/app name: ThePhoneSearch
Purpose: connect MobileParts/MPS supplier catalogue directly to the user's eBay Germany business without requiring a separate ecommerce website. Supplier products should appear in a professional desktop/dashboard app, be organized like MobileParts by brand -> device/model -> part category -> individual parts, and ultimately synchronize safely with eBay.

A Windows Electron desktop build has already been created through GitHub Actions. Workflow run 32921829113 produced artifact `ThePhoneSearch-Windows` / installer `ThePhoneSearch Setup 1.0.0.exe`.

Hosting/backend currently uses Vercel. At handover time Vercel Hobby build rate limiting was preventing the newest commits from deploying. GitHub status showed `build-rate-limit`. Verify this first in the new chat; do not assume it is still blocked.

## Supplier: MobileParts / MPS
The supplier API is authenticated and was previously confirmed working. Do not expose credentials in UI, commits, logs, handover text, or chat replies. Credentials belong in environment variables only.

The integration already includes supplier authentication/session handling, catalogue/part retrieval, stock/cost information, basket/order preparation concepts, shipment/tracking retrieval, and dropship workflow work.

Important business rule: MobileParts charges EUR 8.40 shipping for a Germany dropship/customer shipment. It is ONE supplier shipping charge per customer shipment/order, not EUR 8.40 per individual part when several eligible items ship together to the same customer.

## eBay
Marketplace: EBAY_DE
Currency: EUR
Inventory location previously confirmed: `duesseldorf-neusalzerweg-2b`
Known business policy IDs from prior live status:
- Fulfillment: 237515391013
- Payment: 227722366013
- Return: 227722240013

Do not blindly trust IDs forever; verify against eBay before live writes.

The eBay connection/authentication previously tested OK. The project has Inventory/Fulfillment API integration and code for inventory items/offers/order fulfillment.

There were 5 existing LIVE eBay listings that the user wants audited and improved. Do not create duplicates. The existing `api/sync.js` contains `audit-live-five` and guarded `fix-live-five` functionality. It pulls published offers, matches SKU to MobileParts, audits current title/description/price/policy/quantity, calculates recommendations, and only considers a listing ready if supplier match/orderability/stock/margin validation passes.

The 5 live listings had NOT been blindly modified at the last verified point because the newest Vercel deployment had not caught up. Verify actual current eBay state before claiming otherwise.

## Pricing rules — VERY IMPORTANT
User wants automated pricing, competitor-aware, with a MINIMUM 30% net margin. 30% is the floor, not the target/maximum. If the market allows substantially more margin, charge more while remaining commercially sensible.

Germany shipping economics:
- Actual MobileParts supplier shipping cost: EUR 8.40 per customer shipment.
- Customer-facing eBay shipping: EUR 4.99.
- Additional eligible items in the same combined customer shipment should add EUR 0 shipping so buyer pays EUR 4.99 once.
- The remaining EUR 3.41 supplier shipping burden must be recovered in the economics/item price, never ignored.
- Profit calculations must include the FULL EUR 8.40 supplier shipping cost.

Fee assumptions currently encoded in pricing logic include eBay product fee, a shipping fee assumption, 19% VAT on applicable eBay fees, and fixed fee. Inspect `api/_lib/pricing.js` before changing anything and verify assumptions against the user's actual eBay fee structure before final live launch.

Competitor comparison must use TOTAL BUYER PRICE, not just item price:
our item price + our EUR 4.99 shipping vs competitor item price + competitor shipping.

For cheap parts, do not simply add EUR 8.40 visible shipping. The EUR 4.99/customer + embedded remainder approach exists specifically to avoid making low-cost parts unattractive while protecting margin.

EU shipping must use a separate profile with the same concept, but DO NOT invent the supplier's EU shipping cost. Obtain/verify the real MobileParts EU delivery charge before activating EU pricing/shipping.

## AI / smart listing optimization
User explicitly does NOT want a paid AI dependency. Do not require OpenAI API credits, ChatGPT Plus API use, or another paid AI service in the finished app.

A local/built-in listing optimizer exists in `api/_lib/ai-listing.js`. It should intelligently parse supplier information, classify part type, identify brand/model/color/quality terms, generate/scoring title candidates, keep eBay titles within 80 characters, and generate professional descriptions. Improve this locally/rule-based where useful.

Never hallucinate compatibility, model, color, condition, OEM/original status, or specifications. Supplier data is the source of truth. If uncertain, use conservative wording or flag for review.

The user wants the 5 existing live listings' titles, descriptions, prices and postage corrected using this same safe optimizer/pricing engine once deployment and validation are working.

## Catalogue / dashboard UX
User wants ALL MobileParts parts visible in the app, not a small sample.

Catalogue navigation should resemble MobileParts:
brand -> device/model -> categories/parts, e.g. Apple -> iPhone 17 Pro Max -> LCD / battery / other parts.

Do not lump unrelated parts together. Earlier parsing also produced a bad-looking `resin pc` classification; classification/category cleanup is important.

The user dislikes a narrow left sidebar that requires endless scrolling. Brand/model/category panels should open side-by-side where practical, and this behavior must work for ALL brands, not only Apple.

Dashboard should be professional, dark mode, suitable for a 4K display, with strong typography, spacing and readable financial cards. Products view should use the same professional design standard.

Orders dashboard testing previously used fake orders including a 20-order scenario. Top cards should show aggregate totals such as revenue/income, supplier expense/costs, eBay charges and net profit.

## Order workflow
Desired real workflow:
1. Customer buys on eBay.
2. App imports the real eBay order.
3. Validate paid status and delivery address.
4. Match every line item/SKU to MobileParts.
5. Check current supplier stock/orderability and required quantity.
6. Calculate/show supplier basket and economics.
7. Prepare the MobileParts order/basket for the user's approval/payment.
8. After supplier order exists, retrieve MobileParts shipment/tracking.
9. Send carrier/tracking back to eBay and mark fulfillment appropriately.
10. Prevent duplicate supplier orders and duplicate tracking writes.

Critical payment decision: user does NOT expect the app to magically pay MobileParts. The desired safe model is to prepare/send the eBay order into the MobileParts basket/order preparation flow so the user can place/pay for the supplier order. Automatic supplier purchasing must remain locked unless a robust payment design and durable idempotency are explicitly approved later.

Durable idempotency is mandatory before any automatic supplier purchase. Never allow a retry/timeout to purchase the same supplier order twice.

Tracking logic should check existing eBay fulfillments before writing tracking, to avoid duplicate fulfillment/tracking records.

## User-controlled LIVE/OFF switch — NEXT IMPORTANT FEATURE
The user now wants the whole application to be technically ready for production BUT under their direct control: 'live but not live'. Build a clear master control in the dashboard/desktop app.

Recommended design:
- Large status indicator: SAFE / PREVIEW vs LIVE.
- Default SAFE/PREVIEW after installation/restart unless intentionally persisted securely.
- A `GO LIVE` button should NOT instantly perform a destructive action merely by accidental click. Use an explicit confirmation screen summarizing what will become enabled.
- A `GO SAFE` / `PAUSE LIVE` control must immediately disable future live writes.
- The UI must show exactly which capabilities are armed.

Prefer separate capability toggles beneath the master switch so the user remains in charge:
1. eBay listing publishing/updating
2. stock/price synchronization
3. eBay tracking/fulfillment writes
4. supplier order preparation
5. automatic supplier purchasing — KEEP OFF/LOCKED until durable idempotency/payment safety is implemented and explicitly approved

Backend authorization must enforce state server-side; a front-end button alone is not security. Existing admin guard uses `ADMIN_TOKEN` or `EBAY_VERIFICATION_TOKEN` via `x-admin-token` (`api/_lib/admin.js`). Do not expose that token in renderer/browser source.

Do not rely only on environment variables if the user expects an interactive runtime toggle. Implement a durable, secure runtime settings/state mechanism appropriate to the architecture, with safe defaults and auditability. If durable backend storage is not yet available, do not fake persistence; clearly implement/label the safest available behavior and add storage before enabling dangerous writes.

Every dangerous write path must check the same centralized live-control policy. Avoid scattered independent booleans that can disagree.

## Existing safety switches / concepts
Historically the project used values such as:
- `SYNC_MODE=preview/live`
- `EBAY_PUBLISH`
- guarded supplier-purchase switch
- guarded automatic tracking switch

Inspect current repository code for exact names. Consolidate these behind the user-facing control instead of leaving confusing contradictory switches.

Publishing and money-moving actions should remain OFF while testing. The user wants a fully working system where THEY decide when to arm live actions.

## Security
Never commit supplier/eBay/admin credentials.
Never print credentials in dashboard responses.
Never put admin token in renderer JavaScript.
Use environment variables / secure backend storage.
Do not expose an unrestricted live mutation endpoint publicly.
Use POST + admin authentication + explicit confirmations for destructive actions.
Keep logs/audit records for live-mode changes and important writes if storage is available.

## Desktop app
The project has an Electron desktop wrapper under `desktop/` and GitHub Actions Windows build. The desktop app should be the final primary interface; the user does not want to depend on ChatGPT after completion.

A previous Windows installer successfully built with Electron 37.10.3 / electron-builder. Build log noted Node 20 deprecation/engine warnings and two high-severity npm audit findings. These should be reviewed/upgraded carefully rather than blindly running `npm audit fix --force` and risking breakage.

No custom application icon was configured at that build; Electron default icon was used. This is cosmetic remaining polish.

## Vercel / deployment
At last check, Vercel Hobby had a build-rate-limit failure on the newest commit. Earlier function-count pressure was addressed by consolidating/removing redundant endpoints, with the core live-five audit/fix consolidated into `/api/sync`.

First task in a new chat: inspect GitHub HEAD and current Vercel deployment status. If the rate limit has cleared, verify the newest backend is actually READY before testing mutation endpoints. Never claim a GitHub commit is live merely because it exists in main.

## Important current files to inspect
- `api/_lib/admin.js` — backend admin guard
- `api/_lib/pricing.js` — margin/fee/shipping economics
- `api/_lib/ai-listing.js` — free built-in listing optimizer
- `api/_lib/ebay.js` — eBay integration
- `api/_lib/mps.js` — MobileParts integration
- `api/sync.js` — sync plus live-five audit/fix consolidation
- order/order-automation related API files — inspect repository for current exact paths
- `app.html` and related UI files
- `desktop/` — Electron application
- `.github/workflows/` — Windows build workflow

## What remains before calling it genuinely production-ready
1. Verify newest GitHub commit successfully deploys to Vercel.
2. Test status/auth/MPS/eBay connections on the deployed version.
3. Implement the user-controlled SAFE/LIVE control described above with centralized backend enforcement.
4. Verify all catalogue pages/brands/models/categories and all supplier items load correctly, not just Apple/sample data.
5. Verify Germany combined shipping behavior on actual eBay business policy and checkout behavior.
6. Obtain real MobileParts EU shipping costs and finish EU profile.
7. Audit the 5 existing live listings in READ-ONLY mode first; review supplier matches and calculated economics.
8. Only then allow the user to intentionally apply fixes to those five listings.
9. Test a complete fake order and multiple-order scenario through basket preparation/tracking without supplier payment.
10. Add durable idempotency/order state storage before even considering automatic supplier purchasing.
11. Review desktop dependency/security warnings and rebuild installer after final UI/backend changes.
12. Final end-to-end test, then user decides when to press GO LIVE.

## Communication style for this project
The user has repeatedly asked not to be interrupted with 'what next?' after every change. If a step is safe and clearly implied, do it. Ask only when genuinely required (credentials, real shipping amount, irreversible financial/public action, etc.).

Be precise about three states:
- CODED = exists in GitHub
- DEPLOYED = newest code is actually running on Vercel/backend
- LIVE ENABLED = mutation/publishing/payment behavior is intentionally armed

Never confuse these states.

## Final principle
The finished product should feel fully operational while remaining safely under the user's control. Preview mode should exercise as much of the real pipeline as possible without publishing listings, changing live eBay data, spending money, or falsely marking orders shipped. The user should be able to inspect everything and then deliberately switch approved capabilities LIVE from the desktop dashboard when ready.
