// Cloudflare Pages Function: /api/verify
// Sprawdza bezpośrednio w Stripe, czy sesja płatności została opłacona.
// Działa tylko na Cloudflare Pages (na GitHub Pages sprzedaż jest zablokowana).
//
// Zmienne (Cloudflare Pages → Settings → Variables and Secrets, typ „Secret”):
//   STRIPE_SECRET_KEY – WYŁĄCZNIE klucz ograniczony „rk_live_…” z uprawnieniem „Checkout Sessions: Read”.
//                       Pełny klucz „sk_…” jest odrzucany (gdyby wyciekł, dawałby dostęp do pieniędzy).
//   PAYMENT_LINK_ID   – identyfikator linku płatności „plink_…” (Stripe → Payment Links → szczegóły linku).
//   EXPECTED_AMOUNT   – cena w groszach (domyślnie 999 = 9,99 zł).
//   MAX_AGE_DAYS      – ile dni po płatności można pobierać PDF (domyślnie 30).
//   ALLOW_TEST_MODE   – „true” tylko na czas testów (akceptuje płatności testowe). Na produkcji NIE ustawiaj.
//
// Zapytania:
//   GET /api/verify?ping=1                       → { ready: true|false }  (czy sprzedaż jest skonfigurowana)
//   GET /api/verify?session_id=cs_…&ref=w…       → { paid: true|false }

const SID_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  const url = new URL(request.url);
  if (url.searchParams.has('ping')) return json({ ready: isConfigured(env) });
  if (!isConfigured(env)) return json({ paid: false, error: 'not_configured' }, 503);

  const sid = url.searchParams.get('session_id') || '';
  const ref = url.searchParams.get('ref') || '';
  if (!SID_RE.test(sid) || !REF_RE.test(ref)) return json({ paid: false, error: 'invalid_request' }, 400);

  let session;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    if (res.status === 404) return json({ paid: false });
    if (!res.ok) return json({ paid: false, error: 'upstream' }, 502);
    session = await res.json();
  } catch (e) {
    return json({ paid: false, error: 'upstream' }, 502);
  }
  return json(evaluateSession(session, ref, env));
}

export function isConfigured(env) {
  return typeof env.STRIPE_SECRET_KEY === 'string' && /^rk_(live|test)_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY) &&
    typeof env.PAYMENT_LINK_ID === 'string' && /^plink_[A-Za-z0-9]+$/.test(env.PAYMENT_LINK_ID);
}

export function evaluateSession(s, ref, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!s || typeof s !== 'object') return { paid: false };
  const expected = Number(env.EXPECTED_AMOUNT || 999);
  const maxAgeDays = Number(env.MAX_AGE_DAYS || 30);
  const allowTest = env.ALLOW_TEST_MODE === 'true';
  const valid =
    s.object === 'checkout.session' &&
    s.mode === 'payment' &&
    s.status === 'complete' &&
    s.payment_status === 'paid' &&
    s.currency === 'pln' &&
    s.amount_subtotal === expected &&
    s.amount_total > 0 &&
    s.payment_link === env.PAYMENT_LINK_ID &&
    s.client_reference_id === ref &&
    (s.livemode === true || allowTest);
  if (!valid) return { paid: false };
  if (!Number.isFinite(s.created) || nowSeconds - s.created > maxAgeDays * 86400) return { paid: false, error: 'expired' };
  return { paid: true };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extra
    }
  });
}
