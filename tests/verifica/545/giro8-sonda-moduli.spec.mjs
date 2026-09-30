// #545 giro 8, sonda: Commenta con del testo già selezionato, e una scorciatoia con Invio premuta nei campi dei moduli.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apriDocConModuli(page, modules, comments = []) {
  await page.evaluate(({ mods, comments }) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo bello' }] }] },
      comments,
      modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, { mods: modules, comments });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: { shortcut: 'Ctrl+Shift+3' } };

test('Commenta: testo selezionato con la tastiera, poi la scorciatoia', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [COMMENT]);
  await page.click('#doc');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  console.log('SONDA selezione:', await page.evaluate(() => String(getSelection())));
  await page.keyboard.press('Control+Shift+Digit3');
  await page.waitForTimeout(1600);
  console.log('SONDA dopo scorciatoia, pannello:', await page.locator('#overlay').isVisible(), await page.locator('#overlay h3').allInnerTexts());
  await page.screenshot({ path: 'tests/.shots/giro8-commenta-tastiera.png' });
});

test('Commenta: testo selezionato col mouse, poi la scorciatoia', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [COMMENT]);
  const box = await page.locator('#doc p').first().boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.up();
  console.log('SONDA selezione mouse:', await page.evaluate(() => String(getSelection())));
  await page.keyboard.press('Control+Shift+Digit3');
  await page.waitForTimeout(1600);
  console.log('SONDA dopo scorciatoia (mouse), pannello:', await page.locator('#overlay').isVisible(), await page.locator('#overlay h3').allInnerTexts());
});

test('Commenta: con un commento già presente, clic e scorciatoia', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [COMMENT], [{ id: 'k1', text: 'nota', anchor: { from: 0, to: 4, text: 'ciao' }, created: new Date().toISOString(), resolved: false }]);
  await page.locator('.ed-module[data-type="comment"] .ed-mod-pad').click();
  console.log('SONDA clic:', await page.locator('#overlay h3').allInnerTexts());
  await page.keyboard.press('Escape');
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit3');
  await page.waitForTimeout(200);
  console.log('SONDA scorciatoia:', await page.locator('#overlay').innerText().catch(() => ''));
});

test('scorciatoia con Invio premuta nel campo della chat', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [
    { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Ctrl+Alt+Enter' } },
    { id: 'ch-t', type: 'chat', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} },
  ]);
  const input = page.locator('[data-chat="input"]');
  await input.click();
  await input.fill('domanda a metà');
  await page.keyboard.press('Control+Alt+Enter');
  await page.waitForTimeout(400);
  console.log('SONDA chat: campo=', JSON.stringify(await input.inputValue()), 'statistiche=', await page.locator('#overlay h3', { hasText: 'Statistiche' }).isVisible());
});
