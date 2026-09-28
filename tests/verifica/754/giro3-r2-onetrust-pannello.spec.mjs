// Verifica #754 giro 3, rilievo 2: OneTrust senza «Rifiuta» in nessuno dei due livelli.
// Filo apre il pannello delle preferenze e lo lascia davanti alla pagina; la lista vera nomina solo l'involucro.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Come la lista EasyList Cookie vera: l'involucro, il banner e il velo, non il pannello.
const LISTA = '###onetrust-banner-sdk\n###onetrust-consent-sdk\n##.onetrust-pc-dark-filter';

const OT = `<title>OT_PANNELLO</title>
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
      <label>Marketing <input type="checkbox" id="ot-mkt" class="category-switch-handler" checked></label>
      <button class="save-preference-btn-handler onetrust-close-btn-handler"
        onclick="window.__saved={mkt:document.getElementById('ot-mkt').checked};document.getElementById('onetrust-consent-sdk').remove()">Conferma le mie scelte</button>
      <button id="accept-recommended-btn-handler" onclick="window.__acc=1">Consenti tutti</button>
    </div>
  </div>`;

test('OneTrust col solo «Accetta» e «Impostazioni»: niente resta aperto e niente è accettato', async ({ app, openTab, testServer }) => {
  await app.evaluate((_, l) => globalThis.__filoCookieBanners.setListForTest(l), LISTA);
  const page = await testServer.openReady(openTab, OT);
  await sleep(10_000);
  const st = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).display !== 'none'; };
    return { acc: window.__acc || null, saved: window.__saved || null, banner: vis('onetrust-banner-sdk'), pannello: vis('onetrust-pc-sdk') };
  });
  expect(st.acc).toBeNull();
  expect(st.banner).toBe(false);
  expect(st.pannello).toBe(false);
  if (st.saved) expect(st.saved.mkt).toBe(false);
});
