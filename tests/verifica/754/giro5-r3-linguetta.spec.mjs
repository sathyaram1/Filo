// #754 giro 5, rilievo 3: la linguetta del sito per riaprire le preferenze non è un banner, e il menu non lo dice.

import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

// Forma di CookieLawInfo (GDPR Cookie Consent per WordPress); la riga della linguetta è di EasyList Cookie.
const CLI = `<title>CLI</title>
  <style>body{margin:0} .page{height:3000px}</style>
  <div class="page">contenuto</div>
  <script>
    const risposto = document.cookie.includes('cookielawinfo-checkbox-advertisement=');
    if (!risposto) {
      document.write('<div id="cookie-law-info-bar" style="position:fixed;bottom:0;left:0;right:0;height:90px;background:#fff;box-sizing:border-box;padding:10px">'
        + '<span>Questo sito usa i cookie. <a role="button" id="cookie_action_close_header" class="cli_action_button" onclick="rispondi(\\'yes\\')">Accetta</a> '
        + '<a role="button" id="cookie_action_close_header_reject" class="cookie_action_close_header_reject cli_action_button" onclick="rispondi(\\'no\\')">Rifiuta</a></span></div>');
    }
    document.write('<div id="cookie-law-info-again" style="position:fixed;bottom:0;right:100px;width:160px;height:28px;background:#eee;display:' + (risposto ? 'block' : 'none') + '"><span id="cookie_hdr_showagain">Privacy e cookie</span></div>');
    function rispondi(v) {
      document.cookie = 'cookielawinfo-checkbox-advertisement=' + v + '; path=/; max-age=86400';
      document.cookie = 'viewed_cookie_policy=' + v + '; path=/; max-age=86400';
      document.getElementById('cookie-law-info-bar').remove();
      document.getElementById('cookie-law-info-again').style.display = 'block';
    }
  </script>`;

test('rifiutato il banner, alla pagina dopo la linguetta «Privacy e cookie» non diventa «Banner dei cookie nascosto»', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-law-info-bar\n###cookie-law-info-again'));
  const a = await openTab(testServer.html(CLI));
  await a.waitForFunction(() => document.cookie.includes('cookielawinfo-checkbox-advertisement=no'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(1500);
  await a.reload();
  await a.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await sleep(3000);
  expect((await tabCookies(shell)).hidden).toBe(false);
});
