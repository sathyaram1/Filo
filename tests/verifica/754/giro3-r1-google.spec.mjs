// Verifica #754 giro 3, rilievo 1: il riquadro del consenso di Google (Funding Choices) resta aperto.
// Con «Non acconsento» Filo deve premerlo; senza, deve nasconderlo senza accettare. La lista vera non lo nomina.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function google(conNonAcconsento) {
  return `<title>GOOGLE_FC</title>
  <style>body{margin:0} .page{height:4000px}</style>
  <div class="page">ricetta lunga</div>
  <div class="fc-consent-root" dir="ltr" tabindex="0">
    <div class="fc-dialog-container" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483646">
      <div class="fc-dialog fc-choice-dialog" role="dialog" aria-modal="true" style="background:#fff;width:500px;padding:20px">
        <div class="fc-dialog-content"><h1 class="fc-dialog-headline">Il sito ricette.example chiede il consenso all'utilizzo dei tuoi dati personali per:</h1>
          <p>Annunci e contenuti personalizzati, misurazione di annunci e contenuti, ricerche sul pubblico e sviluppo di servizi</p></div>
        <div class="fc-footer-buttons-container"><div class="fc-footer-buttons">
          ${conNonAcconsento ? `<button class="fc-button fc-cta-do-not-consent fc-secondary-button" role="button" aria-label="Non acconsento" onclick="window.__fc='no';document.body.style.overflow='';document.querySelector('.fc-consent-root').remove()"><p class="fc-button-label">Non acconsento</p></button>` : ''}
          <button class="fc-button fc-cta-consent fc-primary-button" role="button" aria-label="Acconsento" onclick="window.__fc='si';document.cookie='FCCDCF=si; path=/';document.querySelector('.fc-consent-root').remove()"><p class="fc-button-label">Acconsento</p></button>
          <button class="fc-button fc-cta-manage-options fc-secondary-button" role="button" aria-label="Gestisci opzioni"><p class="fc-button-label">Gestisci opzioni</p></button>
        </div></div>
      </div>
    </div>
    <div class="fc-dialog-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483645"></div>
  </div>
  <script>document.body.style.overflow='hidden'</script>`;
}

const aperto = () => {
  const d = document.querySelector('.fc-dialog');
  if (!d || !d.isConnected) return false;
  const r = d.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && getComputedStyle(d).visibility !== 'hidden';
};

test('Google col «Non acconsento»: Filo lo preme', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, google(true));
  await expect.poll(() => page.evaluate(() => window.__fc || null), { timeout: 12_000 }).toBe('no');
  expect(await page.evaluate(() => document.cookie)).not.toContain('FCCDCF');
});

test('Google senza «Non acconsento»: il riquadro sparisce, niente accettato', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, google(false));
  await expect.poll(() => page.evaluate(aperto), { timeout: 12_000 }).toBe(false);
  await sleep(1500);
  expect(await page.evaluate(() => [window.__fc || null, document.cookie.includes('FCCDCF')])).toEqual([null, false]);
});
