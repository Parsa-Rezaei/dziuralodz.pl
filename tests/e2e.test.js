// Test end-to-end (Playwright + Chromium + poppler-utils): kalkulatory, kreator, zdjęcia, PDF i bezpieczeństwo płatności.
// Uruchom: node tests/e2e.test.js [katalog-na-wyniki]
// /api/verify jest atrapą (page.route) – prawdziwą funkcję testuje tests/verify.test.mjs.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'public'); // katalog publikowany (Cloudflare Pages: output directory = public)
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'dziura-e2e-'));
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(ok, msg, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}${!ok && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 600) : ''}`);
  if (!ok) failures++;
}

/* ---------- nagłówki z public/_headers (blok "/*"), żeby test działał z prawdziwym CSP ---------- */
const HEADERS = {};
{
  let inBlock = false;
  for (const line of fs.readFileSync(path.join(SITE, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) inBlock = line.trim() === '/*';
    else if (inBlock && line.includes(':')) { const i = line.indexOf(':'); HEADERS[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}

const MODE = { paymentUrl: '' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
  const file = path.join(SITE, rel);
  if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  let body = fs.readFileSync(file);
  if (rel === '/assets/config.js' && MODE.paymentUrl) body = Buffer.from(body.toString('utf8').replace("paymentUrl: '',", `paymentUrl: '${MODE.paymentUrl}',`));
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...HEADERS });
  res.end(body);
});

const pad = n => String(n).padStart(2, '0');
const d = new Date(Date.now() - 2 * 864e5);
const INCIDENT = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PAY_KEY = 'dziuralodz.pay.v1';

async function newPage(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'pl-PL', ...opts });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  // Chrome ignoruje COOP na testowym hoście http (produkcja to HTTPS) – to nie jest błąd aplikacji.
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Cross-Origin-Opener-Policy')) page.errors.push(m.text()); });
  return { context, page };
}
async function pdfInfo(download, name) {
  const f = path.join(OUT, name);
  await download.saveAs(f);
  return {
    text: execFileSync('pdftotext', ['-layout', f, '-']).toString(),
    images: execFileSync('pdfimages', ['-list', f]).toString().trim().split('\n').length - 2,
    pages: +execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/)[1]
  };
}
async function noDownload(page, action, ms = 1500) {
  let got = false;
  const h = () => { got = true; };
  page.on('download', h);
  await action();
  await page.waitForTimeout(ms);
  page.off('download', h);
  return !got;
}
const locked = page => page.$eval('#doc-locked', e => !e.classList.contains('hidden')); // stan blokady niezależnie od bieżącego kroku kreatora

async function addPhotos(page, imgs) {
  for (let n = 1; n <= 3; n++) {
    await page.locator(`.photo-slot[data-photo="${n}"] .photo-input`).nth(1).setInputFiles({ name: `p${n}.jpg`, mimeType: 'image/jpeg', buffer: imgs[n - 1] });
  }
  await page.waitForFunction(() => document.querySelector('#photo-status').textContent.includes('wszystkie 3'));
}
// Szybkie wypełnienie kreatora (bez sprawdzania walidacji) – do testów płatności.
async function fillWizard(page) {
  await page.locator('input[name="road_type"][value="city"]').check();
  await page.fill('#owner_name', 'Józef Żółkiewski-Łęcki');
  await page.fill('#owner_phone', '600 100 200');
  await page.fill('#owner_address', 'ul. Piotrkowska 1, 90-001 Łódź');
  await page.fill('#owner_id', '44051401359');
  await page.fill('#iban', 'PL61109010140000071219812874');
  await page.click('#wiz-next');
  await page.fill('#make', 'Škoda'); await page.fill('#model', 'Octavia'); await page.fill('#plate', 'EL 12345'); await page.fill('#vin', 'TMBJJ7NE5L0123456');
  await page.click('#wiz-next');
  await page.fill('#date', INCIDENT); await page.fill('#time', '20:00'); await page.fill('#street', 'Przybyszewskiego'); await page.fill('#building', 'przy nr 120');
  await page.fill('#speed', '40'); await page.fill('#limit', '50');
  await page.fill('#pot_l', '60'); await page.fill('#pot_w', '45'); await page.fill('#pot_d', '12');
  await page.click('#desc-gen');
  await page.click('#wiz-next');
  await page.click('#wiz-next');
  await page.fill('#items-body input[data-f="amount"]', '650');
  await page.locator('input[data-k="truth"]').check();
  await page.click('#wiz-next');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const LOCAL = `http://127.0.0.1:${port}/`;
  const PROD = `http://dziura.test:${port}/`; // nie-lokalna domena: tryb demonstracyjny musi być wyłączony
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP dziura.test 127.0.0.1'] });

  // Zdjęcia testowe: zrzuty ekranu kolorowych bloków.
  const shot = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const photo = async (color, label) => {
    await shot.setContent(`<body style="margin:0;background:${color};display:grid;place-items:center;height:100vh;font:bold 120px sans-serif;color:#fff">${label}</body>`);
    return shot.screenshot({ type: 'jpeg', quality: 80 });
  };
  const imgs = [await photo('#475569', 'DZIURA'), await photo('#0f766e', 'ULICA'), await photo('#b45309', 'EL 12345')];
  await shot.close();

  /* ======================= 1. Lokalnie, tryb demonstracyjny: funkcje i PDF ======================= */
  console.log('— LOKALNIE (tryb demonstracyjny)');
  let { context, page } = await newPage(browser);
  await page.goto(LOCAL);
  check((await page.title()).includes('Odszkodowanie za dziurę w drodze Łódź'), 'tytuł strony');
  check(await page.locator('h1').innerText() === 'Odszkodowanie za dziurę w drodze w Łodzi', 'nagłówek H1');
  const ld = await page.$$eval('script[type="application/ld+json"]', s => s.map(x => JSON.parse(x.textContent)['@type']));
  check(ld.includes('FAQPage') && ld.includes('SoftwareApplication'), 'JSON-LD poprawny (FAQPage + SoftwareApplication)');
  const partnersTxt = await page.locator('#partners').innerText();
  check(partnersTxt.includes('Miejsce dla partnera – kontakt') && partnersTxt.includes('WhatsApp'), 'neutralna ramka partnera z kontaktem (bez wymyślonych firm)');

  await page.locator('input[name="road_type"][value="city"]').check();
  check((await page.locator('#juris-result').innerText()).includes('Zgłaszasz do ZDiT'), 'Krok 0: droga w Łodzi → ZDiT');
  await page.locator('input[name="road_type"][value="gddkia"]').check();
  check((await page.locator('#juris-result').innerText()).includes('GDDKiA'), 'Krok 0: autostrada → GDDKiA');
  await page.locator('input[name="road_type"][value="city"]').check();

  await page.fill('#calc_cost', '1200');
  await page.fill('#calc_premium', '1800');
  await page.fill('#calc_loss', '15');
  await page.fill('#calc_years', '2');
  await page.fill('#calc_deductible', '500');
  check(/1\s?040,00/.test(await page.locator('#calc-result').innerText()), 'kalkulator: różnica 500 + 1800×15%×2 = 1040 zł (bezpłatnie)');

  await addPhotos(page, imgs);
  check(true, 'moduł zdjęć: 3 zdjęcia dodane');
  check(await page.evaluate(() => !Object.values(sessionStorage).some(v => v.includes('data:image'))), 'zdjęcia zapisane w IndexedDB, nie w sessionStorage');

  await page.click('#wiz-next');
  check(await page.locator('#step-error').isVisible(), 'walidacja: pusty krok 1 zablokowany');
  await page.fill('#owner_name', 'Józef Żółkiewski-Łęcki');
  await page.fill('#owner_phone', '600 100 200');
  await page.fill('#owner_address', 'ul. Piotrkowska 1, 90-001 Łódź');
  await page.fill('#owner_id', '44051401358');
  await page.fill('#iban', 'PL61109010140000071219812874');
  await page.click('#wiz-next');
  check((await page.locator('#step-error').innerText()).includes('PESEL'), 'walidacja: zły PESEL wykryty');
  await page.fill('#owner_id', '44051401359');
  await page.click('#wiz-next');
  check(await page.locator('.wiz-step[data-step="2"]').isVisible(), 'krok 1 → 2');

  await page.fill('#make', 'Škoda');
  await page.fill('#model', 'Octavia');
  await page.fill('#plate', 'el 12345');
  check(await page.inputValue('#plate') === 'EL 12345', 'numer rejestracyjny zamieniany na wielkie litery');
  await page.fill('#vin', 'TMBJJ7NE5L0123456');
  await page.click('#wiz-next');

  await page.fill('#date', INCIDENT);
  check((await page.locator('#insurer-box').innerText()).includes('1077814389'), 'krok 3: polisa PZU 1077814389 dla bieżącego roku');
  await page.fill('#time', '20:00');
  await page.fill('#street', 'Przybyszewskiego');
  await page.fill('#building', 'przy nr 120');
  await page.fill('#speed', '40');
  await page.fill('#limit', '50');
  await page.fill('#pot_l', '60');
  await page.fill('#pot_w', '45');
  await page.fill('#pot_d', '12');
  await page.click('#desc-gen');
  check((await page.inputValue('#description')).includes('ul. Przybyszewskiego'), 'generator opisu zdarzenia');
  await page.fill('#street', 'A1 węzeł Łódź Wschód');
  check((await page.locator('#street-alert').innerText()).includes('GDDKiA'), 'alert: autostrada wpisana w polu ulicy');
  await page.fill('#street', 'Przybyszewskiego');
  await page.click('#wiz-next');

  await page.locator('.wiz-step[data-step="4"] input[data-k="police"]').check();
  await page.locator('input[data-k="witness"]').check();
  await page.fill('#w_name', 'Anna Nowak');
  await page.fill('#w_address', 'ul. Zgierska 5, 91-001 Łódź');
  await page.selectOption('#w_gender', 'k');
  await page.click('#witness-gen');
  check((await page.inputValue('#witness_text')).includes('byłam świadkiem'), 'generator oświadczenia świadka (forma żeńska)');
  await page.click('#wiz-next');

  await page.fill('#items-body input[data-f="amount"]', '650');
  await page.click('#item-add');
  await page.locator('#items-body input[data-f="amount"]').nth(1).fill('800');
  check(/1\s?450,00/.test(await page.locator('#items-total').innerText()), 'suma roszczenia 1450 zł');
  await page.click('#wiz-next');
  check((await page.locator('#step-error').innerText()).includes('pole wymagane'), 'walidacja: brak oświadczenia o prawdzie');
  await page.locator('input[data-k="truth"]').check();
  await page.click('#wiz-next');
  check((await page.locator('#summary').innerText()).includes('PZU S.A., polisa OC Miasta Łodzi nr 1077814389'), 'podgląd: adresat i polisa');
  check((await page.locator('#score-box').innerText()).includes('100'), 'wskaźnik dowodów 100/100');
  check(await page.$eval('#score-box .score-bar', e => e.style.width) === '100%', 'pasek wskaźnika ustawiony mimo CSP (bez atrybutu style)');
  await page.screenshot({ path: path.join(OUT, 'mobile-step6.png') });

  await page.click('#btn-download');
  check(await page.locator('#dlgCheckout').isVisible() && await page.locator('#coDemo').isVisible(), 'demo: okno zamówienia z informacją o trybie demonstracyjnym');
  check(await noDownload(page, () => page.click('#coPay')), 'bez zaznaczenia zgód PDF się nie pobiera');
  check((await page.locator('#coError').innerText()).includes('obie zgody'), 'komunikat: wymagane obie zgody');
  await page.locator('#coTerms').check();
  check(await noDownload(page, () => page.click('#coPay'), 800), 'jedna zgoda nie wystarcza');
  await page.locator('#coWithdraw').check();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#coPay')]);
  const free = await pdfInfo(dl, 'demo.pdf');
  check(free.text.includes('ZGŁOSZENIE SZKODY W POJEŹDZIE'), 'PDF: tytuł z polskimi znakami');
  check(free.text.includes('Józef Żółkiewski-Łęcki'), 'PDF: znaki ą ć ę ł ń ó ś ź ż (Józef Żółkiewski-Łęcki)');
  check(free.text.includes('nr polisy 1077814389'), 'PDF: numer polisy');
  check(free.text.includes('Tuwima 36'), 'PDF: adres ZDiT');
  check(free.text.includes('OŚWIADCZENIE ŚWIADKA ZDARZENIA'), 'PDF: oświadczenie świadka');
  check(free.text.includes('286 § 1'), 'PDF: klauzula art. 286 § 1 KK');
  check(free.text.includes('art. 817 § 1'), 'PDF: art. 817 KC');
  check(free.text.includes('PL 61 1090 1014 0000 0712 1981 2874'), 'PDF: IBAN sformatowany');
  check(free.images === 3, `PDF: 3 zdjęcia w załączniku (jest ${free.images})`);
  check(free.pages >= 4, `PDF: ${free.pages} stron`);
  check(await page.evaluate(() => window.__csp.length === 0), 'brak naruszeń CSP (lokalnie)', await page.evaluate(() => window.__csp));
  check(page.errors.length === 0, 'brak błędów JS (lokalnie)', page.errors);
  await context.close();

  /* ======================= 2. Domena produkcyjna bez linku płatności ======================= */
  console.log('— PRODUKCJA bez paymentUrl');
  ({ context, page } = await newPage(browser));
  await page.goto(PROD);
  await fillWizard(page);
  check(await locked(page), 'podgląd pisma zablokowany (szare paski)');
  check(!(await page.locator('#doc-locked').innerText()).includes('Żółkiewski') && !(await page.content()).includes('ZGŁOSZENIE SZKODY W POJEŹDZIE'), 'zablokowany podgląd nie zawiera treści płatnego dokumentu');
  check(await noDownload(page, () => page.click('#btn-download')), 'brak darmowego PDF na prawdziwej domenie');
  check(await page.locator('#coUnavailable').isVisible() && await page.locator('#coPay').isDisabled() && !(await page.locator('#coDemo').isVisible()), 'sprzedaż wyłączona: komunikat, przycisk nieaktywny, brak trybu demo');
  await context.close();

  /* ======================= 3. Produkcja z płatnością: bezpieczeństwo i pełny przepływ ======================= */
  console.log('— PRODUKCJA z płatnością Stripe');
  MODE.paymentUrl = 'https://buy.stripe.com/test_dziura';
  const PAY = { ready: true, ref: '', sid: '', calls: [] };
  ({ context, page } = await newPage(browser));
  await context.route('**/api/verify**', route => {
    const u = new URL(route.request().url());
    PAY.calls.push(u.search);
    let body;
    if (u.searchParams.has('ping')) body = { ready: PAY.ready };
    else body = { paid: !!PAY.ref && u.searchParams.get('ref') === PAY.ref && u.searchParams.get('session_id') === PAY.sid };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const stripeHits = [];
  await context.route('https://buy.stripe.com/**', route => {
    const u = new URL(route.request().url());
    stripeHits.push(u);
    PAY.ref = u.searchParams.get('client_reference_id') || '';
    PAY.sid = 'cs_live_' + crypto.randomBytes(12).toString('hex');
    route.fulfill({ status: 302, headers: { location: `${PROD}?platnosc=sukces&session_id=${PAY.sid}` } });
  });

  await page.goto(PROD);
  await addPhotos(page, imgs);
  await fillWizard(page);
  check(await locked(page), 'przed płatnością: podgląd zablokowany');
  check(await noDownload(page, () => page.click('#btn-download')), 'przed płatnością: przycisk otwiera zamówienie, nie pobiera PDF');
  check(await page.locator('#dlgCheckout').isVisible() && !(await page.locator('#coUnavailable').isVisible()), 'okno zamówienia z ceną i zgodami');
  check((await page.locator('#dlgCheckout').innerText()).includes('9,99'), 'cena 9,99 zł w oknie zamówienia');
  await page.keyboard.press('Escape');

  // Oszustwo 1: samo ?platnosc=sukces w adresie
  await page.goto(PROD + '?platnosc=sukces');
  await page.waitForTimeout(500);
  check(await locked(page), 'SECURITY: samo ?platnosc=sukces nie odblokowuje');
  check(!page.url().includes('platnosc'), 'adres oczyszczony z parametrów płatności');
  check(await noDownload(page, () => page.click('#btn-download')), 'SECURITY: po ?platnosc=sukces nadal brak PDF bez płatności');
  await page.keyboard.press('Escape');

  // Oszustwo 2: ?platnosc=sukces z wymyślonym session_id, bez zamówienia w tej przeglądarce
  await page.goto(PROD + '?platnosc=sukces&session_id=cs_live_fakefakefake12345');
  await page.waitForTimeout(500);
  check(await locked(page), 'SECURITY: wymyślony session_id nie odblokowuje');

  // Oszustwo 3: podrobiony localStorage (+ stara flaga z poprzedniej wersji w sessionStorage)
  await page.evaluate(k => {
    localStorage.setItem(k, JSON.stringify({ ref: 'w' + 'a'.repeat(32), sid: 'cs_live_forgedforged1234', ts: Date.now() }));
    sessionStorage.setItem('dziuralodz.paid', '1');
  }, PAY_KEY);
  await page.reload();
  await page.waitForFunction(k => localStorage.getItem(k) === null, PAY_KEY, { timeout: 5000 }).catch(() => {});
  check(await locked(page), 'SECURITY: podrobiony localStorage nie odblokowuje');
  check(await page.evaluate(k => localStorage.getItem(k) === null, PAY_KEY), 'SECURITY: podrobiony zapis usunięty po odrzuceniu przez serwer');
  check(await noDownload(page, () => page.click('#btn-download')), 'SECURITY: po podrobieniu localStorage brak PDF');
  await page.keyboard.press('Escape');

  // Serwer weryfikujący niedostępny → klient NIE trafia do płatności
  PAY.ready = false;
  await page.click('#btn-download');
  await page.locator('#coTerms').check();
  await page.locator('#coWithdraw').check();
  await page.click('#coPay');
  await page.waitForSelector('#coError:not(.hidden)');
  check((await page.locator('#coError').innerText()).includes('Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków'), 'verify niedostępne: komunikat „Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków”');
  check(stripeHits.length === 0, 'verify niedostępne: brak przekierowania do Stripe');
  PAY.ready = true;

  // Prawdziwy przepływ: Stripe → powrót → weryfikacja → automatyczne pobranie
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#coPay')]);
  const hit = stripeHits[0];
  check(!!hit && /^w[0-9a-f]{32}$/.test(hit.searchParams.get('client_reference_id') || ''), 'przekierowanie do Payment Link z client_reference_id');
  check(PAY.calls.some(q => q.includes('session_id=' + PAY.sid) && q.includes('ref=' + PAY.ref)), 'po powrocie: weryfikacja sesji i ref na serwerze');
  const paid = await pdfInfo(dl2, 'paid.pdf');
  check(paid.text.includes('Józef Żółkiewski-Łęcki') && paid.text.includes('ZGŁOSZENIE SZKODY W POJEŹDZIE'), 'po płatności: PDF pobrany automatycznie, polskie znaki poprawne');
  check(paid.images === 3, `po płatności: 3 zdjęcia przetrwały przekierowanie do Stripe (jest ${paid.images})`);
  check(!(await locked(page)), 'po płatności: podgląd odblokowany');
  check(!page.url().includes('session_id'), 'po płatności: adres oczyszczony');
  const stores = await page.evaluate(() => ({ local: JSON.stringify(Object.assign({}, localStorage)) }));
  check(!stores.local.includes('Żółkiewski') && !stores.local.includes('data:image'), 'PRYWATNOŚĆ: w localStorage brak danych osobowych i zdjęć', stores.local);

  // Ponowne pobranie po odświeżeniu (30 dni, ta sama przeglądarka)
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#doc-locked').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btn-download')]);
  check((await pdfInfo(dl3, 'paid-again.pdf')).text.includes('Żółkiewski'), 'po odświeżeniu: ponowne pobranie bez nowej płatności');
  check(await page.evaluate(() => window.__csp.length === 0), 'brak naruszeń CSP (produkcja)', await page.evaluate(() => window.__csp));
  check(page.errors.length === 0, 'brak błędów JS (produkcja)', page.errors);

  // Opłacony session_id w innej przeglądarce (inny ref) nie działa
  const other = await newPage(browser);
  await other.context.route('**/api/verify**', route => {
    const u = new URL(route.request().url());
    const body = u.searchParams.has('ping') ? { ready: true } : { paid: u.searchParams.get('ref') === PAY.ref && u.searchParams.get('session_id') === PAY.sid };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await other.page.goto(PROD);
  await other.page.evaluate(([k, sid]) => localStorage.setItem(k, JSON.stringify({ ref: 'w' + 'b'.repeat(32), sid, ts: Date.now() })), [PAY_KEY, PAY.sid]);
  await other.page.goto(`${PROD}?platnosc=sukces&session_id=${PAY.sid}`);
  await other.page.waitForTimeout(7500); // 3 ponowienia co 2 s
  check(await locked(other.page), 'SECURITY: udostępniony link z session_id nie działa w innej przeglądarce');
  await other.context.close();
  await context.close();

  /* ======================= 4. Układ ======================= */
  MODE.paymentUrl = '';
  ({ context, page } = await newPage(browser));
  await page.goto(LOCAL);
  await page.screenshot({ path: path.join(OUT, 'mobile-top.png') });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'brak poziomego przewijania na telefonie');
  await page.click('footer [data-open="dlgTerms"]');
  const terms = (await page.locator('#dlgTerms').innerText()).replace(/\s/g, ' ');
  check(terms.includes('9,99 zł') && terms.includes('art. 38 pkt 13'), 'Regulamin: cena i podstawa utraty prawa odstąpienia');
  await page.keyboard.press('Escape');
  await page.click('footer [data-open="dlgPrivacy"]');
  check((await page.locator('#dlgPrivacy').innerText()).includes('IndexedDB'), 'Polityka prywatności opisuje przechowywanie zdjęć');
  await context.close();

  await browser.close();
  server.close();
  console.log(`\nWyniki: ${OUT}\n${failures ? `${failures} FAIL` : 'Wszystkie testy OK'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
