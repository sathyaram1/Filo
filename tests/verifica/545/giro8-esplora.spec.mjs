// #545 giro 8, esplorazione: ogni combinazione plausibile, data a Conteggio parole, o si rifiuta o parte.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
test.setTimeout(900000);

async function apriDocConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };

function combinazioni() {
  const out = [];
  const lettere = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const cifre = '0123456789'.split('');
  const modsL = [['Ctrl'], ['Ctrl', 'Shift'], ['Ctrl', 'Alt'], ['Alt'], ['Alt', 'Shift'], ['Ctrl', 'Alt', 'Shift']];
  for (const mods of modsL) for (const l of lettere) out.push([[...mods, l.toUpperCase()].join('+'), [...mods.map((m) => (m === 'Ctrl' ? 'Control' : m)), `Key${l.toUpperCase()}`].join('+')]);
  for (const mods of [['Ctrl'], ['Ctrl', 'Shift'], ['Ctrl', 'Alt'], ['Alt', 'Shift'], ['Ctrl', 'Alt', 'Shift']]) for (const d of cifre) out.push([[...mods, d].join('+'), [...mods.map((m) => (m === 'Ctrl' ? 'Control' : m)), `Digit${d}`].join('+')]);
  const nomi = [['Space', 'Space'], ['Enter', 'Enter'], ['Tab', 'Tab'], ['Backspace', 'Backspace'], ['Delete', 'Delete'], ['Home', 'Home'], ['End', 'End'],
    ['PageUp', 'PageUp'], ['PageDown', 'PageDown'], ['Insert', 'Insert'], ['Up', 'ArrowUp'], ['Down', 'ArrowDown'], ['Left', 'ArrowLeft'], ['Right', 'ArrowRight'], ['Esc', 'Escape']];
  for (const mods of [['Ctrl'], ['Alt'], ['Ctrl', 'Shift'], ['Alt', 'Shift'], ['Ctrl', 'Alt']]) for (const [n, k] of nomi) out.push([[...mods, n].join('+'), [...mods.map((m) => (m === 'Ctrl' ? 'Control' : m)), k].join('+')]);
  for (const mods of [['Ctrl'], ['Alt'], ['Ctrl', 'Shift']]) for (let i = 1; i <= 12; i++) out.push([[...mods, `F${i}`].join('+'), [...mods.map((m) => (m === 'Ctrl' ? 'Control' : m)), `F${i}`].join('+')]);
  const punt = [[',', 'Comma'], ['.', 'Period'], ['/', 'Slash'], [';', 'Semicolon'], ["'", 'Quote'], ['[', 'BracketLeft'], [']', 'BracketRight'], ['`', 'Backquote']];
  for (const mods of [['Ctrl'], ['Alt']]) for (const [n, k] of punt) out.push([[...mods, n].join('+'), [...mods.map((m) => (m === 'Ctrl' ? 'Control' : m)), k].join('+')]);
  return out;
}

test('ogni combinazione accettata parte davvero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  const esiti = { rifiutate: [], partite: [], morte: [] };
  const statistiche = page.locator('#overlay h3', { hasText: 'Statistiche' });
  for (const [scritta, premi] of combinazioni()) {
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritta);
    await page.click('#cfgSave');
    if (await page.locator('#overlay').isVisible()) {
      const msg = await page.locator('#cfgShortcutTaken').isVisible() ? await page.locator('#cfgShortcutTaken').innerText() : 'hint modificatore';
      esiti.rifiutate.push(`${scritta} → ${msg}`);
      await page.click('#cfgCancel');
      await page.locator('.ed-module[data-type="settings"]').click();
      continue;
    }
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeHidden();
    await page.click('#doc');
    await page.keyboard.press(premi);
    let partita = false;
    try { await statistiche.waitFor({ state: 'visible', timeout: 500 }); partita = true; } catch (_) {}
    (partita ? esiti.partite : esiti.morte).push(scritta);
    if (await page.locator('#overlay').isVisible()) await page.keyboard.press('Escape');
    if (!page.url().startsWith('filo://editor')) { esiti.morte.push(`${scritta} (ha portato via: ${page.url()})`); break; }
  }
  console.log('ESITI ' + JSON.stringify(esiti, null, 1));
});
