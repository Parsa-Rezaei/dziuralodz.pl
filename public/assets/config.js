/* =====================================================================
   USTAWIENIA STRONY – jedyny plik, który edytujesz przed startem.
   NIGDY nie wpisuj tutaj kluczy Stripe (sk_…, rk_…) ani haseł –
   ten plik jest publiczny. Klucze trzymasz wyłącznie w ustawieniach
   Cloudflare Pages (Variables and Secrets).
   ===================================================================== */
window.SITE_CONFIG = Object.freeze({
  siteName: 'DziuraŁódź',
  siteUrl: 'https://dziuralodz.pl/',

  // Cena pakietu PDF w zł – musi być równa cenie produktu w Stripe i zmiennej EXPECTED_AMOUNT (w groszach: 999).
  price: 9.99,

  // Link płatności Stripe (Payment Link, tylko BLIK), np. 'https://buy.stripe.com/abc123'.
  // W Stripe: After payment → Redirect → https://TWOJA-DOMENA.pl/?platnosc=sukces&session_id={CHECKOUT_SESSION_ID}
  // Pusty = sprzedaż wyłączona (na komputerze lokalnym działa tryb demonstracyjny z darmowym PDF).
  paymentUrl: 'https://buy.stripe.com/7sY8wR1vtcJ77b4c3t83C05',

  // Weryfikacja płatności po stronie serwera (functions/api/verify.js na Cloudflare Pages).
  // Wymagana do sprzedaży – bez niej przycisk płatności się nie uruchomi.
  verifyEndpoint: '/api/verify',

  // Dane sprzedawcy do regulaminu i polityki prywatności.
  seller: Object.freeze({
    name: 'Mohammad Parsa Rezaei',
    address: 'ul. Politechniki 3B, pok. 717, 93-590 Łódź',
    email: 'parsa.rezaei.2014@gmail.com'
  }),

  // ── REKLAMA LOKALNA / PARTNERZY ───────────────────────────────────────
  // Kontakt dla firm, które chcą wykupić miejsce reklamowe. Puste = brak linku.
  adContactEmail: '',
  // Telefon dla reklamodawców (pokazywany jako SMS / WhatsApp). Puste = ukryte.
  adContactPhone: '+48579139744',

  // Partnerzy wyświetlani na górze strony (tylko prawdziwe, opłacone reklamy). Przykład wpisu:
  // { name: 'Nazwa firmy', text: 'Krótki opis.', phone: '+48 …', url: 'https://…' }
  // Pusta lista = neutralna ramka „Miejsce dla partnera – kontakt”.
  partners: []
});
