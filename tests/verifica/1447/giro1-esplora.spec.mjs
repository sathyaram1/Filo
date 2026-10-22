// Verifica #1447 giro 1: esplorazione della correzione automatica fuori dal caso felice.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
</body>`;

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, ripetizioni: true, automatica: true },
    });
    const finto = async () => ({ text: 'NIENTE', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

async function apri(app, openTab, testServer) {
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const valore = (page) => page.locator('#ta').inputValue();
const errore = (page, testo) => page.locator('.sn-spell-overlay .sn-errore', { hasText: testo });
async function svuota(page, sel = '#ta') {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

test('chat di casa: perchè e marco', async ({ app, openTab }) => {
  await prepara(app);
  const page = await openTab('filo://dashboard/dashboard.html');
  const input = page.locator('#input');
  await input.click();
  await page.waitForTimeout(2500);
  await page.keyboard.type('Domani vedo marco perchè ');
  await expect.poll(() => input.inputValue(), { timeout: 3000 }).toBe('Domani vedo Marco perché ');
});

test('elisione: l\'italia', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Domani Giulia va in Francia. Amo l\'italia e la sua gente ');
  await page.waitForTimeout(1500);
  const v = await valore(page);
  const segnato = await errore(page, 'italia').count();
  console.log('ELISIONE', JSON.stringify(v), 'segnato', segnato);
  expect(v.includes("l'Italia") || segnato === 0).toBe(true);
});

test('emoji, e\', maiuscole', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Ciao 😀 marco perchè ');
  expect(await valore(page)).toBe('Ciao 😀 Marco perché ');
  await svuota(page);
  await page.keyboard.type('E\' vero, e\' così ');
  expect(await valore(page)).toBe('È vero, è così ');
  await svuota(page);
  await page.keyboard.type('CIAO PERCHÈ ');
  expect(await valore(page)).toBe('CIAO PERCHÉ ');
  await svuota(page);
  await page.keyboard.type('Dimmi qual’è ');
  expect(await valore(page)).toBe('Dimmi qual è ');
});

test('annulla correzione dal tasto destro dopo aver scritto prima della parola', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Domani vedo marco al mare. ');
  expect(await valore(page)).toBe('Domani vedo Marco al mare. ');
  await page.evaluate(() => document.getElementById('ta').setSelectionRange(0, 0));
  await page.keyboard.type('Sì. ');
  expect(await valore(page)).toBe('Sì. Domani vedo Marco al mare. ');
  // Il punto sulla parola «Marco» nello specchio del campo.
  const p = await page.evaluate(() => {
    const ov = document.querySelector('.sn-spell-overlay');
    const w = document.createTreeWalker(ov, NodeFilter.SHOW_TEXT);
    let tot = 0; const r = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.nodeValue.indexOf('Marco');
      if (i >= 0) { r.setStart(n, i + 1); r.setEnd(n, i + 3); break; }
      tot += n.nodeValue.length;
    }
    const q = r.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Annulla correzione')).toBeVisible({ timeout: 5000 });
  await menu.voce('Annulla correzione').click();
  await expect.poll(() => valore(page)).toBe('Sì. Domani vedo marco al mare. ');
});

test('tema scuro: il lampo', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('Ok perchè ');
  const lampo = page.locator('.sn-spell-lampo');
  await expect(lampo.first()).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/1447-v-lampo-ce.png' }).catch(() => {});
  const c = await lampo.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log('LAMPO', c);
});
