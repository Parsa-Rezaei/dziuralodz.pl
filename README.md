# DziuraŁódź – pothole damage claim kit for Łódź

A Polish website for drivers who damaged a tyre, rim or suspension in a pothole in Łódź. It shows where to file (ZDiT or GDDKiA), compares claiming from the city's insurer against the driver's own AC policy, checks the 3 photos ZDiT requires, and generates a ready-to-sign A4 PDF: the claim letter, a witness statement and a photo appendix.

Form data and photos stay in the visitor's browser (form in `sessionStorage`, photos in IndexedDB, auto-deleted after 24 h). The only server code is `functions/api/verify.js`, which asks Stripe whether a checkout session was paid. The calculators, photo check and claim preview are free; the generated PDF package costs **9,99 zł** (BLIK).

## Repository layout

| Path | What it is |
|---|---|
| `public/` | The website (the only thing published): `index.html`, `assets/` (`app.js`, `config.js`, `styles.css`), `vendor/` (pdfmake), `_headers`, `robots.txt`, `sitemap.xml`, favicon, OG image |
| `functions/api/verify.js` | Cloudflare Pages Function: server-side Stripe payment check |
| `src/input.css` | Tailwind source for `public/assets/styles.css` |
| `tests/` | `verify.test.mjs` (payment check, `node --test`), `e2e.test.js` (Playwright end-to-end) |

## Setup (Cloudflare Pages)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → pick this repository.
2. Build settings: framework preset **None**, build command **empty**, build output directory **`public`**. The `functions/` folder is deployed automatically.
3. **Settings → Variables and Secrets** (Production, type **Secret**):
   - `STRIPE_SECRET_KEY` = `rk_live_…` – a **restricted** key with only *Checkout Sessions: Read*. A full `sk_…` key is refused.
   - `PAYMENT_LINK_ID` = `plink_…` (Stripe → Payment Links → the link's details).
   - `EXPECTED_AMOUNT` = `999` (price in grosze; must match the Stripe price and `price` in `config.js`).
   - Optional: `MAX_AGE_DAYS` (default 30). `ALLOW_TEST_MODE=true` only while testing with Stripe test mode – never in production.
4. Stripe → **Payment Links → New**: one product "Pakiet dokumentów PDF – zgłoszenie szkody", **9,99 PLN**, payment methods **BLIK only**. After payment → **Don't show confirmation page → Redirect** to
   `https://DOMAIN/?platnosc=sukces&session_id={CHECKOUT_SESSION_ID}`
5. Edit `public/assets/config.js`: `paymentUrl` = the `https://buy.stripe.com/…` link, `seller` = your name/company, address and e-mail (shown in the Regulamin and Polityka prywatności). **Never put any key in `config.js`** – it is public.
6. Redeploy, then check `https://DOMAIN/api/verify?ping=1` returns `{"ready":true}`. If it does not, the site refuses to send buyers to Stripe ("Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków").

How the payment works: the browser creates a random order id, stores it in `localStorage` and sends it to Stripe as `client_reference_id`; the form is kept in `sessionStorage` and photos in IndexedDB so they survive the redirect. After returning, the site calls `/api/verify`, which checks with Stripe that the session is paid, complete, in PLN, for the expected amount, from this Payment Link, live mode, not older than 30 days, and that its `client_reference_id` matches. Only then is the PDF generated and downloaded. Editing the URL or `localStorage` does not unlock anything.

Demo mode (free PDF) runs only on `localhost` / `127.0.0.1` while `paymentUrl` is empty.

## `public/assets/config.js`

| Setting | What it does |
|---|---|
| `paymentUrl` | Stripe Payment Link (BLIK). Empty = sales off (demo mode only on localhost). |
| `verifyEndpoint` | `/api/verify` – leave as is. |
| `price` | `9.99` – shown on the page; must equal `EXPECTED_AMOUNT` / 100. |
| `seller` | `name`, `address`, `email` for the Regulamin and Polityka prywatności (required by Polish consumer law). |
| `adContactEmail`, `adContactPhone` | Contact shown in the partner box for businesses that want to advertise. |
| `partners` | Real, paid local ads only. Empty = neutral "Miejsce dla partnera – kontakt" box. |

## Custom domain

Cloudflare Pages → Custom domains. Then replace the old `github.io` address in `public/index.html`, `public/robots.txt` and `public/sitemap.xml`, and set `siteUrl` in `config.js`.

## Keep the facts current

The city's insurer data (PZU S.A., policy 1077814389) covers incidents from 2023–2026. When Łódź publishes the insurer for 2027, update `PZU` in `public/assets/app.js` and the texts in `public/index.html`.

## For developers

```
npm install
npm run build   # compiles Tailwind CSS to public/assets/styles.css and copies pdfmake to public/vendor/
npm test        # payment-check unit tests + end-to-end test in Chromium (needs Playwright and poppler-utils)
```
