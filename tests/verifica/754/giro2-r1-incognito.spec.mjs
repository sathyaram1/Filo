// #754 giro 2, rilievo 1: «Mostra il banner dei cookie» usato in una finestra incognito non deve toccare il profilo
// normale: la risposta che il sito si era segnata fuori dall'incognito resta, e il menu della scheda normale non cambia.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Il sito ricorda la risposta in un cookie di consenso, come fanno i CMP veri.
const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();</script>`;

async function consensoNormale(app) {
  return app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: 'OptanonConsent' })).map((c) => c.value));
}

test('«Mostra il banner dei cookie» in incognito lascia com\'è il profilo normale', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(RICORDA);

  // Finestra normale: Filo rifiuta, il sito se lo segna.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => consensoNormale(app), { timeout: 10_000 }).toEqual(['rifiutato']);
  const normale = async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.find((x) => x.id === snap.activeId).cookies;
  });
  await expect.poll(async () => (await normale())?.rejected, { timeout: 8_000 }).toBe(true);

  // Finestra incognito, stesso sito: Filo rifiuta anche lì, poi l'utente chiede di rivedere il banner.
  await shell.evaluate(() => window.filoShell.openIncognito());
  let incog = null;
  await expect.poll(() => { incog = app.windows().find((w) => w.url().includes('incognito=1')); return !!incog; }, { timeout: 10_000 }).toBe(true);
  await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), url);
  const statoIncognito = () => incog.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? { id: t.id, cookies: t.cookies } : null;
  });
  await expect.poll(async () => (await statoIncognito())?.cookies?.rejected, { timeout: 10_000 }).toBe(true);
  const { id } = await statoIncognito();
  const r = await incog.evaluate((tid) => window.filoShell.tabs.cookieBanners(tid, true), id);
  expect(r && r.ok).toBe(true);
  await expect.poll(async () => (await statoIncognito())?.cookies?.shown, { timeout: 8_000 }).toBe(true);
  await sleep(1500);

  // Il profilo normale non è stato toccato: la risposta del sito c'è ancora, e il suo menu dice ancora «rifiutati».
  expect(await consensoNormale(app)).toEqual(['rifiutato']);
  expect(await normale()).toEqual({ rejected: true, hidden: false, shown: false });
});
