// #545 giro 8, rilievo 2: la scorciatoia di Commenta usa il testo già selezionato, anche con la tastiera.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apriDocConCommenta(page) {
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo bello' }] }] },
      comments: [],
      modules: [
        { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: { shortcut: 'Ctrl+Shift+3' } },
        { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}

test('testo selezionato con la tastiera, poi la scorciatoia di Commenta: si apre il commento su quel testo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConCommenta(page);
  await page.click('#doc');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+Shift+Digit3');
  await expect(page.locator('#overlay h3', { hasText: 'Nuovo commento' })).toBeVisible({ timeout: 2500 });
  await expect(page.locator('#overlay')).toContainText('ciao mondo bello');
});

test('testo selezionato col mouse, poi la scorciatoia di Commenta: si apre il commento su quel testo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConCommenta(page);
  const box = await page.locator('#doc p').first().boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.up();
  const scelto = await page.evaluate(() => String(getSelection()));
  expect(scelto.length).toBeGreaterThan(0);
  await page.keyboard.press('Control+Shift+Digit3');
  await expect(page.locator('#overlay h3', { hasText: 'Nuovo commento' })).toBeVisible({ timeout: 2500 });
  await expect(page.locator('#overlay')).toContainText(scelto);
});
