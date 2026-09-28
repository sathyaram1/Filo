// #545 giro 3, rilievo 1: la scorciatoia di Grassetto, Corsivo, Sottolineato,
// Indietro, Avanti e Chat si salva e, premuta, non fa la cosa del modulo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apriDocConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-g3', meta: { title: 'Giro3', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-g3', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}
async function modifica(page, on) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible({ visible: on });
}
async function conScorciatoia(page, mod, sc) {
  await apriDocConModuli(page, [{ id: 'wc-g3', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } }, mod]);
  await modifica(page, true);
  await page.locator(`.ed-module[data-type="${mod.type}"]`).click();
  await page.fill('#cfgShortcut', sc);
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await modifica(page, false);
  await page.click('#doc');
}
const cella = (type, x) => ({ id: `${type}-g3`, type, cells: [{ x, y: 0 }], data: {} });

for (const [type, sel] of [['bold', 'b, strong'], ['italic', 'i, em'], ['underline', 'u']]) {
  test(`${type}: Ctrl+G sul modulo formatta il testo selezionato`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await conScorciatoia(page, cella(type, 3), 'Ctrl+G');
    await page.keyboard.press('Control+KeyA');
    await page.keyboard.press('Control+KeyG');
    await expect(page.locator('#doc').locator(sel)).toHaveCount(1);
  });
}

test('Indietro: la sua scorciatoia annulla l\'ultima modifica', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await conScorciatoia(page, cella('undo', 4), 'Ctrl+Shift+2');
  await page.keyboard.press('End');
  await page.keyboard.type(' xyz', { delay: 20 });
  await expect(page.locator('#doc')).toContainText('xyz');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#doc')).not.toContainText('xyz');
});

test('Avanti: la sua scorciatoia ripete la modifica annullata', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await conScorciatoia(page, cella('redo', 4), 'Ctrl+Shift+3');
  await page.keyboard.press('End');
  await page.keyboard.type(' xyz', { delay: 20 });
  await page.keyboard.press('Control+KeyZ');
  await expect(page.locator('#doc')).not.toContainText('xyz');
  await page.keyboard.press('Control+Shift+Digit3');
  await expect(page.locator('#doc')).toContainText('xyz');
});

test('Chat: la sua scorciatoia porta il cursore nel campo della chat', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  const chat = { id: 'chat-g3', type: 'chat', cells: [3, 4, 5].flatMap((x) => [0, 1, 2].map((y) => ({ x, y }))), data: {} };
  await conScorciatoia(page, chat, 'Ctrl+Shift+4');
  await page.keyboard.press('Control+Shift+Digit4');
  await expect(page.locator('[data-chat="input"]')).toBeFocused();
});
