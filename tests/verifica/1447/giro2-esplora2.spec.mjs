// Verifica #1447 giro 2: esplorazione 2.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const CHAT = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="log"></div>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:80px;font:22px monospace"></textarea>
  <iframe id="fr" style="width:760px;height:120px" srcdoc="<body><div id='ed' contenteditable='true' lang='it' style='font:22px monospace;min-height:80px'></div></body>"></iframe>
  <script>
    document.getElementById('ta').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const d = document.createElement('p'); d.textContent = e.target.value; document.getElementById('log').appendChild(d); e.target.value = ''; }
    });
  </script>
</body>`;

async function prepara(app, correttore = {}) {
  await app.evaluate(async (_e, c) => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true, ...c },
    });
  }, correttore);
}
async function apri(app, openTab, testServer, correttore) {
  await prepara(app, correttore);
  const page = await testServer.openReady(openTab, CHAT, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const valore = (page) => page.locator('#ta').inputValue();

test('chat minuscola: primo messaggio, poi gli altri, poi ricarica', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ci vediamo da marco ');
  console.log('MIN1:', JSON.stringify(await valore(page)));
  await page.keyboard.press('Enter');
  await page.keyboard.type('ok allora stasera da marco ');
  console.log('MIN2:', JSON.stringify(await valore(page)));
  await page.keyboard.press('Enter');
  await page.keyboard.type('va bene, porto io la pizza a marco ');
  console.log('MIN3:', JSON.stringify(await valore(page)));
  await page.keyboard.press('Enter');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.locator('#ta').click();
  await page.keyboard.type('domani da marco ');
  console.log('MIN4 dopo ricarica:', JSON.stringify(await valore(page)));
});

test('automatica spenta: marco minuscolo segnato?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { automatica: false });
  await page.locator('#ta').click();
  await page.keyboard.type('Domani vedo marco e claude al mare. ');
  await page.waitForTimeout(2500);
  const segni = await page.locator('.sn-spell-overlay .sn-errore').allInnerTexts().catch(() => []);
  console.log('SPENTA:', JSON.stringify(await valore(page)), 'SEGNI', JSON.stringify(segni));
});

test('iframe con div modificabile', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const fr = page.frameLocator('#fr');
  await fr.locator('#ed').click();
  await page.keyboard.type('Domani vedo marco perchè ');
  console.log('IFRAME:', JSON.stringify(await fr.locator('#ed').innerText()));
});

for (const auto of [false, true]) {
  test(`testo lungo, automatica ${auto}`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, { automatica: auto });
    await page.evaluate(() => { document.getElementById('ta').value = 'Ciao. '.repeat(20000); });
    await page.locator('#ta').click();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.keyboard.type('ok va bene perchè sì ');
    console.log(`LUNGO ${auto}:`, JSON.stringify((await valore(page)).slice(-24)), Date.now() - t0, 'ms');
  });
}
