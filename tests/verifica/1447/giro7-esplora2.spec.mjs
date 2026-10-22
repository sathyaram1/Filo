// Giro 7, esplorazione 2: a capo nei campi modificabili, interruttore da Opzioni con la pagina aperta, lampo a vista.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = (bg = '#fff', fg = '#000') => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif;background:${bg};color:${fg}">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px sans-serif;background:${bg};color:${fg}"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;margin-top:12px"></div>
</body>`;

async function pronta(app, page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
}
async function imposta(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
}
const ce = (page, sel = '#ce') => page.locator(sel).evaluate((el) => el.innerText.replace(/ /g, ' '));
async function svuota(page, sel) {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

test('a capo nel campo modificabile', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await imposta(app);
  const page = await testServer.openReady(openTab, PAGINA(), { pubblico: true });
  await pronta(app, page);
  for (const [t, k] of [['Ho visto marco.', 'Enter'], ['Ho visto marco', 'Shift+Enter'], ['Saluti,', null]]) {
    await svuota(page, '#ce');
    await page.keyboard.type(t);
    if (k) await page.keyboard.press(k);
    if (!k) { await page.keyboard.press('Enter'); await page.keyboard.type('marco'); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(250);
    console.log('ACAPO', JSON.stringify(t), k, '=>', JSON.stringify(await ce(page)));
  }
});

const EDITORI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'editori');
const editore = (nome, avvio) => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" contenteditable="true" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${fs.readFileSync(path.join(EDITORI, `${nome}.js`), 'utf8')}</script><script>${avvio}(document.getElementById('m'));</script></body>`;

test('a capo negli editor ricchi', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await imposta(app);
  for (const [nome, avvio, testo] of [['lexical', 'avviaLX', () => window.lxText()], ['prosemirror', 'avviaPM', () => window.pmView.state.doc.textBetween(0, window.pmView.state.doc.content.size, '\n')]]) {
    const page = await testServer.openReady(openTab, editore(nome, avvio), { pubblico: true });
    await pronta(app, page);
    await page.locator(nome === 'prosemirror' ? '#m .ProseMirror' : '#m').click();
    await page.keyboard.type('Ciao marco');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ok');
    await page.waitForTimeout(250);
    console.log('RICCO', nome, JSON.stringify(await page.evaluate(testo)));
  }
});

test('interruttore da Opzioni con la scheda aperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await imposta(app);
  const page = await testServer.openReady(openTab, PAGINA(), { pubblico: true });
  await pronta(app, page);
  const url = page.url();
  const altro = await openTab('filo://options/altro.html');
  const sw = altro.locator('#spellcheckAutomatica');
  await expect(sw).toBeChecked({ timeout: 8000 });
  await sw.uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore.automatica)).toBe(false);
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    if (t) await window.filoShell.tabs.activate(t.id);
  }, url);
  await page.waitForTimeout(500);
  await page.locator('#ta').click();
  await page.keyboard.type('ok perchè marco ');
  await page.waitForTimeout(250);
  const v = await page.locator('#ta').inputValue();
  console.log('SPENTA', JSON.stringify(v));
  expect.soft(v).toBe('ok perchè marco ');
});

test('lampo a vista, chiaro e scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await imposta(app);
  for (const [nome, bg, fg] of [['chiaro', '#fff', '#111'], ['scuro', '#1b1b1f', '#eee']]) {
    if (nome === 'scuro') await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' }));
    const page = await testServer.openReady(openTab, PAGINA(bg, fg), { pubblico: true });
    await pronta(app, page);
    await page.locator('#ta').click();
    await page.keyboard.type('Domani vedo marco perchè ');
    await page.waitForTimeout(120);
    await page.screenshot({ path: `tests/.shots/1447-g7-lampo-${nome}.png`, clip: { x: 0, y: 0, width: 800, height: 160 } });
  }
});

import { menuDi } from '../../helpers/menuContestuale.mjs';
test('annulla dal tasto destro dopo aver scritto prima della parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await imposta(app);
  const page = await testServer.openReady(openTab, PAGINA(), { pubblico: true });
  await pronta(app, page);
  await page.locator('#ce').click();
  await page.keyboard.type('Domani vedo marco al mare. ');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Ciao. ');
  const t = await ce(page);
  console.log('DX prima', JSON.stringify(t));
  const p = await page.evaluate(() => {
    const el = document.getElementById('ce');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.nodeValue.indexOf('Marco');
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 1); r.setEnd(n, i + 4); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }
    }
    return null;
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const voce = menuDi(page).voce('Annulla correzione');
  const vista = await voce.isVisible({ timeout: 4000 }).catch(() => false);
  console.log('DX voce', vista);
  if (vista) { await voce.click(); await page.waitForTimeout(300); }
  console.log('DX dopo', JSON.stringify(await ce(page)));
});
