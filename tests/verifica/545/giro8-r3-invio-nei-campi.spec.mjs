// #545 giro 8, rilievo 3: una scorciatoia con Invio premuta nel campo della chat fa partire il modulo e non manda il messaggio.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('Ctrl+Alt+Invio di Conteggio parole, premuta scrivendo in chat, non manda la domanda a metà', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [
        { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Ctrl+Alt+Invio' } },
        { id: 'ch-t', type: 'chat', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} },
        { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const campo = page.locator('[data-chat="input"]');
  await campo.click();
  await campo.fill('domanda a metà');
  await page.keyboard.press('Control+Alt+Enter');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await expect(campo).toHaveValue('domanda a metà');
});
