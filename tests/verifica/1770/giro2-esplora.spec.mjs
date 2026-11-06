// Verifica #1770 giro 2: la chat per un sito solo, contro il menu della scheda.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test.use({ hostInPiu: ['www.negozio-prova.test'] });

const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    document.cookie = 'sessione=utente; path=/; max-age=86400';
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

async function tabCookiesOf(shell, urlPart) {
  return shell.evaluate(async (u) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => (x.url || '').includes(u));
    return t ? t.cookies : undefined;
  }, urlPart);
}

async function dallaChat(home, valore) {
  const corsa = home.evaluate((v) => window.__filoSidebarTest.runFiloAction(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'siti_con_banner', valore: v }), valore);
  const fine = await Promise.race([corsa.then(() => 'fatto'), home.locator(CONFIRM_HOST).waitFor({ timeout: 10_000 }).then(() => 'conferma', () => 'fatto')]);
  if (fine === 'conferma') {
    await expect.poll(() => home.evaluate(() => {
      const T = window.SN_CONFIRM_UI._test;
      T.scrollToEnd();
      if (T.state() && T.state().hasInput) T.fill('conferma');
      return T.click('ok') || T.click('danger');
    }), { timeout: 8_000 }).toBe(true);
  }
  return corsa;
}

const bannerSites = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.bannerSites);

test('A: rivisto il banner dalla chat, l\'utente accetta, «torna a rifiutarli qui» dalla chat lo rifiuta di nuovo', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, RICORDA, { pubblico: true });
  await page.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  console.log('aggiungi →', JSON.stringify(await dallaChat(home, 'aggiungi questo sito')));
  await expect.poll(() => page.evaluate(() => !!document.getElementById('onetrust-banner-sdk')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await page.click('#onetrust-accept-btn-handler');
  expect(await page.evaluate(() => document.cookie)).toContain('OptanonConsent=accettato');
  console.log('togli →', JSON.stringify(await dallaChat(home, 'togli questo sito')));
  await expect.poll(() => bannerSites(app), { timeout: 6_000 }).toEqual([]);
  await sleep(4000);
  console.log('cookie dopo togli:', await page.evaluate(() => document.cookie));
  console.log('tab cookies:', JSON.stringify(await tabCookiesOf(shell, 'sito-pubblico.test')));
  await expect.poll(() => page.evaluate(() => document.cookie).catch(() => ''), { timeout: 12_000 }).toContain('OptanonConsent=rifiutato');
});

test('B: sito con www, dalla chat: l\'elenco prende il sito intero, il banner torna, e il menu della scheda resta d\'accordo', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const url = testServer.html(RICORDA).replace('127.0.0.1', 'www.negozio-prova.test');
  const page = await openTab(url);
  await page.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 12_000 });
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  console.log('aggiungi →', JSON.stringify(await dallaChat(home, 'aggiungi questo sito')));
  console.log('elenco:', JSON.stringify(await bannerSites(app)));
  await expect.poll(() => page.evaluate(() => !!document.getElementById('onetrust-banner-sdk')).catch(() => false), { timeout: 10_000 }).toBe(true);
  console.log('tab cookies dopo aggiungi:', JSON.stringify(await tabCookiesOf(shell, 'negozio-prova.test')));
  expect((await tabCookiesOf(shell, 'negozio-prova.test'))?.shown).toBe(true);
  expect(await bannerSites(app)).toEqual(['negozio-prova.test']);
  console.log('togli →', JSON.stringify(await dallaChat(home, 'togli questo sito')));
  await expect.poll(() => bannerSites(app), { timeout: 6_000 }).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.cookie).catch(() => ''), { timeout: 12_000 }).toContain('OptanonConsent=rifiutato');
});
