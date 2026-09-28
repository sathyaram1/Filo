// #754 giro 4, rilievo 4: in Privacy l'elenco dei siti dove Filo ha rifiutato i cookie non resta sul disco.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

test('Privacy: dopo il rifiuto, sul disco non resta che quel sito è stato visitato', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(() => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t && t.cookies && t.cookies.rejected;
  }), { timeout: 8_000 }).toBe(true);
  await sleep(2000);
  const salvato = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  expect(salvato && salvato['127.0.0.1']).toBeFalsy();
});
