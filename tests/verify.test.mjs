// Testy funkcji weryfikującej płatność (functions/api/verify.js) z atrapą API Stripe.
// Uruchom: node --test tests/verify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../functions/api/verify.js', import.meta.url), 'utf8');
const { onRequest, evaluateSession, isConfigured } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const NOW = Math.floor(Date.now() / 1000);
const REF = 'w0123456789abcdef0123456789abcdef';
const ENV = { STRIPE_SECRET_KEY: 'rk_live_abc123', PAYMENT_LINK_ID: 'plink_1TestLink', EXPECTED_AMOUNT: '999' };
const good = () => ({
  id: 'cs_live_a1B2c3D4e5F6g7', object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid',
  currency: 'pln', amount_subtotal: 999, amount_total: 999, payment_link: 'plink_1TestLink', client_reference_id: REF,
  livemode: true, created: NOW - 60
});

let stripeCalls = [];
function mockStripe(session, status = 200) {
  globalThis.fetch = async (url, init) => {
    stripeCalls.push({ url, auth: init && init.headers && init.headers.Authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => session };
  };
}
async function call(query, env = ENV, method = 'GET') {
  const res = await onRequest({ request: new Request('https://dziura.example/api/verify' + query, { method }), env });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('isConfigured', () => {
  assert.ok(isConfigured(ENV), 'restricted live key + payment link → ready');
  assert.ok(!isConfigured({ ...ENV, STRIPE_SECRET_KEY: 'sk_live_abc123' }), 'FULL secret key sk_ is refused');
  assert.ok(!isConfigured({ STRIPE_SECRET_KEY: 'rk_live_abc123' }), 'missing PAYMENT_LINK_ID → not ready');
  assert.ok(!isConfigured({}), 'empty env → not ready');
});

test('evaluateSession: valid paid session (9,99 zł)', () => {
  assert.equal(evaluateSession(good(), REF, ENV, NOW).paid, true);
});

test('default EXPECTED_AMOUNT is 999 grosze', () => {
  const env = { STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY, PAYMENT_LINK_ID: ENV.PAYMENT_LINK_ID };
  assert.equal(evaluateSession(good(), REF, env, NOW).paid, true);
  assert.equal(evaluateSession({ ...good(), amount_subtotal: 1499 }, REF, env, NOW).paid, false);
});

test('evaluateSession: rejects tampered or foreign sessions', () => {
  const cases = [
    [{ payment_status: 'unpaid' }, 'unpaid'],
    [{ payment_status: 'no_payment_required' }, '100% discount (no payment)'],
    [{ status: 'open' }, 'open session'],
    [{ status: 'expired' }, 'expired session'],
    [{ currency: 'eur' }, 'wrong currency'],
    [{ amount_subtotal: 100 }, 'wrong price'],
    [{ amount_total: 0 }, 'zero total'],
    [{ payment_link: 'plink_OTHER' }, 'session from another product/link'],
    [{ client_reference_id: 'wSOMEONEELSE0000000000000000000000' }, 'ref mismatch (shared link)'],
    [{ client_reference_id: null }, 'payment made outside the site (no ref)'],
    [{ livemode: false }, 'test-mode payment in production'],
    [{ object: 'payment_intent' }, 'wrong object'],
    [{ mode: 'subscription' }, 'wrong mode']
  ];
  for (const [patch, name] of cases) assert.equal(evaluateSession({ ...good(), ...patch }, REF, ENV, NOW).paid, false, name);
  assert.equal(evaluateSession({ ...good(), livemode: false }, REF, { ...ENV, ALLOW_TEST_MODE: 'true' }, NOW).paid, true, 'test mode only with ALLOW_TEST_MODE');
  const old = evaluateSession({ ...good(), created: NOW - 31 * 86400 }, REF, ENV, NOW);
  assert.deepEqual(old, { paid: false, error: 'expired' }, 'older than 30 days → expired');
  assert.equal(evaluateSession(null, REF, ENV, NOW).paid, false);
  assert.equal(evaluateSession('x', REF, ENV, NOW).paid, false);
});

test('HTTP handler', async () => {
  mockStripe(good());
  let r = await call('?ping=1');
  assert.ok(r.status === 200 && r.body.ready === true, 'ping ready');
  r = await call('?ping=1', { STRIPE_SECRET_KEY: 'sk_live_x', PAYMENT_LINK_ID: 'plink_1' });
  assert.equal(r.body.ready, false, 'ping with sk_ key → not ready');

  stripeCalls = [];
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
  assert.ok(r.status === 200 && r.body.paid === true, 'paid → 200 {paid:true}');
  assert.equal(stripeCalls.length, 1);
  assert.equal(stripeCalls[0].auth, 'Bearer rk_live_abc123');
  assert.equal(stripeCalls[0].url, 'https://api.stripe.com/v1/checkout/sessions/cs_live_a1B2c3D4e5F6g7');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(JSON.stringify(r.body), '{"paid":true}', 'response leaks no session data');

  r = await call('?session_id=cs_live_a1B2c3D4e5F6g7&ref=wWRONGWRONGWRONGWRONG');
  assert.equal(r.body.paid, false, 'wrong ref → paid:false');

  stripeCalls = [];
  r = await call(`?session_id=../../v1/customers&ref=${REF}`);
  assert.ok(r.status === 400 && stripeCalls.length === 0, 'path traversal in session_id → 400, Stripe not called');
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${encodeURIComponent('<script>')}`);
  assert.equal(r.status, 400, 'malformed ref → 400');
  r = await call('?session_id=cs_live_a1B2c3D4e5F6g7');
  assert.equal(r.status, 400, 'missing ref → 400');
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`, { STRIPE_SECRET_KEY: 'sk_live_full', PAYMENT_LINK_ID: 'plink_1TestLink' });
  assert.ok(r.status === 503 && r.body.paid === false, 'sk_ key configured → 503');
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`, ENV, 'POST');
  assert.equal(r.status, 405, 'POST → 405');

  mockStripe({ error: { message: 'No such checkout.session' } }, 404);
  r = await call(`?session_id=cs_live_zzzzzzzzzzzz&ref=${REF}`);
  assert.ok(r.status === 200 && JSON.stringify(r.body) === '{"paid":false}', 'unknown session → paid:false, no detail leaked');
  mockStripe({}, 500);
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
  assert.ok(r.status === 502 && r.body.paid === false, 'Stripe error → 502');
  globalThis.fetch = async () => { throw new Error('network'); };
  r = await call(`?session_id=cs_live_a1B2c3D4e5F6g7&ref=${REF}`);
  assert.ok(r.status === 502 && r.body.paid === false, 'network failure → 502');
});
