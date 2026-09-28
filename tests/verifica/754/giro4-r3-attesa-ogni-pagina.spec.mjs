// #754 giro 4, rilievo 3: un banner che Filo ha già nascosto su un sito, alla pagina dopo non resta davanti per secondi.
import { test, expect } from '../../fixtures/electron.mjs';

const ESTRATTO = ['###cookie-banner', '###didomi-notice', '##.qc-cmp2-container', 'kooora.com##div[id^="sp_message_container_"]'].join('\n');

function spAbbonatiFrame(testServer) {
  return testServer.html(`<title>SP_PAY_FRAME</title>
    <div class="message-container"><div id="notice" class="message type-modal" style="padding:20px">
      <div class="message-component message-row"><p class="message-component">Accetta i cookie per la pubblicità, oppure abbonati.</p></div>
      <div class="message-component message-row">
        <button class="message-component message-button no-children focusable sp_choice_type_11" title="Accetta e continua"
          onclick="parent.postMessage('sp:accept','*')">Accetta e continua</button>
        <button class="message-component message-button no-children focusable sp_choice_type_9" title="Abbonati"
          onclick="parent.postMessage('sp:subscribe','*')">Abbonati</button>
      </div>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
}

// __hiddenAt: quando il centro della finestra torna a essere l'articolo, dall'inizio della pagina.
const articolo = (testServer) => `<title>SP_PAY_TOP</title>
  <style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}</style>
  <div id="sp_message_container_1"
    style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center">
    <iframe id="sp_message_iframe_1" src="${spAbbonatiFrame(testServer)}" style="width:560px;height:300px;border:0;background:#fff"></iframe>
  </div>
  <h1>Articolo</h1><p>contenuto</p>
  <script>
    document.documentElement.classList.add('sp-message-open');
    const iv = setInterval(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (el && !el.closest('#sp_message_container_1')) { window.__hiddenAt = performance.now(); clearInterval(iv); }
    }, 50);
  </script>`;

test('muro «accetta o abbonati» in un riquadro: al secondo articolo dello stesso sito sparisce subito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), ESTRATTO);
  const page = await testServer.openReady(openTab, articolo(testServer));
  await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
  await page.goto(testServer.html(articolo(testServer)));
  await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__hiddenAt)).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__sp || null)).toBeNull();
});

const OT_SOLO_ACCETTA = `<title>OT</title>
  <style>body{margin:0} .page{height:4000px}</style>
  <div class="page">contenuto</div>
  <div id="onetrust-consent-sdk">
    <div class="onetrust-pc-dark-filter" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483645"></div>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:130px;background:#fff;z-index:2147483646">
      <p>Usiamo i cookie per migliorare la tua esperienza.</p>
      <button id="onetrust-pc-btn-handler" onclick="document.getElementById('onetrust-banner-sdk').style.display='none';document.getElementById('onetrust-pc-sdk').style.display='block';document.querySelector('.onetrust-pc-dark-filter').style.display='block'">Impostazioni cookie</button>
      <button id="onetrust-accept-btn-handler" onclick="window.__acc=1">Accetta tutti</button>
    </div>
    <div id="onetrust-pc-sdk" style="display:none;position:fixed;top:10%;left:25%;width:50%;height:60%;background:#fff;z-index:2147483647">
      <h2>Centro preferenze della privacy</h2>
      <label>Marketing <input type="checkbox" id="ot-mkt" checked></label>
      <button class="save-preference-btn-handler">Conferma le mie scelte</button>
    </div>
  </div>
  <script>
    const vis = (i) => { const e = document.getElementById(i); const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const iv = setInterval(() => {
      if (!vis('onetrust-banner-sdk') && !vis('onetrust-pc-sdk')) { window.__hiddenAt = performance.now(); clearInterval(iv); }
    }, 50);
  </script>`;

test('OneTrust col solo «Accetta»: alla seconda pagina dello stesso sito il banner sparisce subito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###onetrust-banner-sdk\n###onetrust-consent-sdk\n##.onetrust-pc-dark-filter'));
  const page = await testServer.openReady(openTab, OT_SOLO_ACCETTA);
  await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
  await page.goto(testServer.html(OT_SOLO_ACCETTA));
  await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__hiddenAt)).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__acc || null)).toBeNull();
});
