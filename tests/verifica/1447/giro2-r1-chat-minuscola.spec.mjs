// Verifica #1447 giro 2, rilievo 1: in una chat dove si scrive tutto minuscolo, i messaggi già mandati non insegnano a
// Filo come si scrive lì quando è la chat a svuotare la casella; e riaperta la pagina riparte da zero.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

// Una chat come tante: Invio manda il messaggio e la pagina svuota la casella da sé.
const CHAT = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="log"></div>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:80px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:60px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <script>
    const manda = (testo) => { const d = document.createElement('p'); d.textContent = testo; document.getElementById('log').appendChild(d); };
    document.getElementById('ta').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(e.target.value); e.target.value = ''; }
    });
    document.getElementById('ce').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(e.target.innerText); e.target.innerHTML = ''; }
    });
  </script>
</body>`;

async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, CHAT, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('r1 nella chat che svuota la casella da sé, dopo due messaggi tutti minuscoli «marco» resta minuscolo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ci vediamo stasera?');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ok porto la pizza');
  await page.keyboard.press('Enter');
  await page.keyboard.type('allora da marco ');
  await page.waitForTimeout(300);
  expect(await page.locator('#ta').inputValue()).toBe('allora da marco ');
});

test('r1 nella chat modificabile che si svuota da sé, uguale', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('ci vediamo stasera?');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ok porto la pizza');
  await page.keyboard.press('Enter');
  await page.keyboard.type('allora da marco ');
  await page.waitForTimeout(300);
  await expect(page.locator('#ce')).toHaveText('allora da marco ');
});

test('r1 riaperta la chat dove si scrive minuscolo, il primo messaggio non prende le maiuscole', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ciao come va. tutto bene. ci vediamo domani.');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ok a dopo. ');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.locator('#ta').click();
  await page.keyboard.type('domani da marco ');
  await page.waitForTimeout(300);
  expect(await page.locator('#ta').inputValue()).toBe('domani da marco ');
});
