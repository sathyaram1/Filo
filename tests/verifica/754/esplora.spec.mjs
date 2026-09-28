// Esplorazione verifica #754 giro 3: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LISTA = process.env.LISTA_VERA ? readFileSync(process.env.LISTA_VERA, 'utf8') : '';

async function lista(app, testo) {
  await app.evaluate((_, t) => globalThis.__filoCookieBanners.setListForTest(t), testo);
}
async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

function fc(conNonAcconsento) {
  return `<title>FC</title>
  <style>body{margin:0} .page{height:4000px}</style>
  <div class="page">ricetta lunga</div>
  <div class="fc-consent-root" dir="ltr" tabindex="0">
    <div class="fc-dialog-container" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483646">
      <div class="fc-dialog fc-choice-dialog" role="dialog" aria-modal="true" style="background:#fff;width:500px;padding:20px;z-index:2">
        <div class="fc-dialog-content"><h1 class="fc-dialog-headline">Il sito ricette.example chiede il consenso all'utilizzo dei tuoi dati personali per:</h1>
          <p>Annunci e contenuti personalizzati, misurazione di annunci e contenuti, ricerche sul pubblico e sviluppo di servizi</p></div>
        <div class="fc-footer-buttons-container"><div class="fc-footer-buttons">
          ${conNonAcconsento ? `<button class="fc-button fc-cta-do-not-consent fc-secondary-button" role="button" aria-label="Non acconsento" onclick="window.__fc='no';document.querySelector('.fc-consent-root').remove()"><p class="fc-button-label">Non acconsento</p></button>` : ''}
          <button class="fc-button fc-cta-consent fc-primary-button" role="button" aria-label="Acconsento" onclick="window.__fc='si';document.cookie='FCCDCF=si; path=/';document.querySelector('.fc-consent-root').remove()"><p class="fc-button-label">Acconsento</p></button>
          <button class="fc-button fc-cta-manage-options fc-secondary-button" role="button" aria-label="Gestisci opzioni"><p class="fc-button-label">Gestisci opzioni</p></button>
        </div></div>
      </div>
    </div>
    <div class="fc-dialog-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483645"></div>
  </div>
  <script>document.body.style.overflow='hidden'</script>`;
}

test('FC con «Non acconsento»: rifiutato o nascosto', async ({ app, openTab, testServer, shell }) => {
  test.skip(!LISTA, 'serve LISTA_VERA');
  await lista(app, LISTA);
  const page = await testServer.openReady(openTab, fc(true));
  await sleep(9000);
  const st = await page.evaluate(() => ({ fc: window.__fc, root: !!document.querySelector('.fc-consent-root'), vis: document.querySelector('.fc-dialog-container') ? getComputedStyle(document.querySelector('.fc-dialog-container')).display : 'gone' }));
  console.log('FC1', JSON.stringify(st), JSON.stringify(await tabCookies(shell)));
  expect(st.fc === 'no' || st.vis === 'none').toBe(true);
});

test('FC senza «Non acconsento»: nascosto, la pagina scorre', async ({ app, openTab, testServer, shell }) => {
  test.skip(!LISTA, 'serve LISTA_VERA');
  await lista(app, LISTA);
  const page = await testServer.openReady(openTab, fc(false));
  await sleep(9000);
  const st = await page.evaluate(() => ({ fc: window.__fc, vis: getComputedStyle(document.querySelector('.fc-dialog-container')).display, y: (window.scrollTo(0, 600), window.scrollY) }));
  console.log('FC2', JSON.stringify(st), JSON.stringify(await tabCookies(shell)));
  expect(st.vis).toBe('none');
});

test('Osano «Ho capito» con la lista vera: nascosto', async ({ app, openTab, testServer, shell }) => {
  test.skip(!LISTA, 'serve LISTA_VERA');
  await lista(app, LISTA);
  const page = await testServer.openReady(openTab, `<title>OSANO</title><p>contenuto</p>
    <div role="dialog" aria-label="cookieconsent" class="cc-window cc-banner cc-type-info cc-theme-block cc-bottom" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#000;color:#fff">
      <span id="cookieconsent:desc" class="cc-message">Questo sito usa i cookie.</span>
      <div class="cc-compliance"><a role="button" tabindex="0" class="cc-btn cc-dismiss" onclick="window.__ok=1">Ho capito</a></div></div>`);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cc-window')).display), { timeout: 10_000 }).toBe('none');
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
});

// gov.uk: la risposta sta in cookies_policy / cookies_preferences_set.
const GOVUK = `<title>GOVUK</title>
  <div class="govuk-cookie-banner" role="region" aria-label="Cookies on GOV.UK" style="position:fixed;top:0;left:0;right:0;height:140px;background:#f3f2f1">
    <p>We use some essential cookies to make this service work.</p>
    <button type="button" class="govuk-button" onclick="document.cookie='cookies_policy={&quot;usage&quot;:true}; path=/; max-age=86400';document.cookie='cookies_preferences_set=true; path=/; max-age=86400';document.querySelector('.govuk-cookie-banner').remove()">Accept additional cookies</button>
    <button type="button" class="govuk-button" onclick="document.cookie='cookies_policy={&quot;usage&quot;:false}; path=/; max-age=86400';document.cookie='cookies_preferences_set=true; path=/; max-age=86400';document.querySelector('.govuk-cookie-banner').remove()">Reject additional cookies</button>
  </div>
  <script>if (document.cookie.includes('cookies_preferences_set=')) document.querySelector('.govuk-cookie-banner').remove();</script>`;

test('gov.uk: rifiutato, poi «Mostra il banner» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, GOVUK);
  await page.waitForFunction(() => document.cookie.includes('cookies_preferences_set'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  const { activeId } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  await shell.evaluate((id) => window.filoShell.tabs.cookieBanners(id, true), activeId);
  await sleep(4000);
  const st = await page.evaluate(() => ({ banner: !!document.querySelector('.govuk-cookie-banner'), c: document.cookie }));
  console.log('GOVUK', JSON.stringify(st), JSON.stringify(await tabCookies(shell)));
  expect(st.banner).toBe(true);
});

// Un secondo riquadro del sito (scelta del paese) col suo velo, insieme al banner col solo «Accetta».
const PAESE = `<title>PAESE</title>
  <style>body{margin:0;overflow:hidden} .page{height:4000px}</style>
  <div class="page">negozio</div>
  <div class="country-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900"></div>
  <div class="country-modal" style="position:fixed;top:30%;left:30%;width:40%;background:#fff;z-index:901;padding:20px">
    <p>Scegli il tuo paese</p><button>Italia</button><button>Svizzera</button></div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:1001">
    <p>Usiamo i cookie.</p><button onclick="window.__accepted=true">Accetta</button></div>`;

test('velo di un altro riquadro del sito: resta', async ({ app, openTab, testServer }) => {
  await lista(app, '###cookie-notice');
  const page = await testServer.openReady(openTab, PAESE);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(5000);
  const st = await page.evaluate(() => ({ velo: getComputedStyle(document.querySelector('.country-overlay')).display, y: (window.scrollTo(0, 600), window.scrollY) }));
  console.log('PAESE', JSON.stringify(st));
  expect(st.velo).not.toBe('none');
});
