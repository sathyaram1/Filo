// Verifica #1433, giro 1, rilievo 2: la scorciatoia data a un vecchio modulo continua a funzionare dopo il passaggio
// al pannello, anche per gli strumenti che non stanno fra quelli di partenza.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('r2 la scorciatoia del vecchio modulo Grassetto mette ancora il grassetto', async ({ openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.evaluate(() => {
    localStorage.setItem('filo.editor.collection', JSON.stringify({
      version: 2, activeId: 'f1',
      files: [{
        id: 'f1', meta: { title: 'Vecchio', created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z', version: 1, grid: { cols: 7, rows: 10 } },
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
        comments: [],
        modules: [
          { id: 'm1', type: 'word-count', cells: [{ x: 0, y: 0, z: 0 }], data: { count: 'words' } },
          { id: 'm2', type: 'bold', cells: [{ x: 1, y: 0, z: 0 }], data: { shortcut: 'Ctrl+G' } },
        ],
      }],
    }));
  });
  await ed.reload();
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await expect(ed.locator('#doc')).toContainText('ciao mondo');
  await ed.waitForTimeout(800);
  await ed.click('#doc');
  await ed.keyboard.press('Control+KeyA');
  await ed.keyboard.press('Control+KeyG');
  await expect(ed.locator('#doc b, #doc strong').first()).toContainText('ciao');
});
