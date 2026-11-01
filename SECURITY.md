# Security checklist (owner)

The website has no database and stores no visitor data on a server, so there is nothing on it to steal. The only server code checks Stripe payments. The real risk is someone taking over **your accounts** and changing the payment link or phone number. Protect the accounts:

1. **GitHub:** turn on two-factor authentication (Settings → Password and authentication). Use a passkey or an authenticator app, not SMS. Whoever can edit `public/assets/config.js` controls where payments go.
2. **Cloudflare:** two-factor authentication. Keep `STRIPE_SECRET_KEY` a restricted `rk_live_…` key with only *Checkout Sessions: Read*; never put any key in the repository.
3. **Gmail (business):** 2-step verification, plus a recovery phone and email.
4. **Stripe:** 2-step authentication. Accept **BLIK only** at first: card payments on a cheap product attract stolen-card testing, and each dispute costs a fee.
5. **Domain registrar (OVH / nazwa.pl):** 2-step authentication and domain transfer lock. Auto-renew ON, so the domain does not expire and get bought by someone else.
6. **Phishing:** Stripe, GitHub and OVH never ask for your password by email or SMS. Always log in by typing the address yourself.
7. **AI browser agent:** never give it passwords, 2FA codes, card numbers or ID documents. Enter those yourself.
8. **Monthly:** open `public/assets/config.js` on GitHub and check that `paymentUrl`, `adContactPhone` and `partners` are what you set.

## Payment check
The PDF unlocks only after `functions/api/verify.js` confirms with Stripe that the checkout session is paid, for this Payment Link, the expected amount (999 grosze), in PLN, live mode, and bound to the order id created in this browser. Typing `?platnosc=sukces` or editing `localStorage` unlocks nothing (covered by `tests/e2e.test.js`).

## Built-in protections
- Content-Security-Policy (`public/_headers`): only the site's own scripts and styles, `connect-src 'self'`, `frame-ancestors 'none'`.
- Links from `config.js` must be `https://`. `javascript:` and similar links are refused.
- The page refuses to run inside another site's frame (header + script).
- All text typed by users is escaped before it is shown on the page.
- The PDF library is a pinned copy stored in this repository; nothing loads from external CDNs.
