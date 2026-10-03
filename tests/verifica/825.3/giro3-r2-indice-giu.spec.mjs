// Giro 3, rilievo 2: con l'indicizzazione che non risponde (la chiave c'è) il
// pannello dice «manca la chiave» e non lascia riprovare né propone niente.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('indicizzazione giù: il pannello propone lo stesso le schede, o almeno lascia riprovare senza dare la colpa alla chiave', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }], {
    chiamate: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }],
    indiceGiu: true,
  });
  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  const note = panel.locator('.dash-delete-note');
  await expect(note).not.toHaveText(/Cerco nell/, { timeout: 15_000 });
  await expect(note).not.toContainText('manca la chiave');
  const proposte = await panel.locator('.dash-delete-list li').allTextContents();
  const riprova = await panel.locator('.dash-action-btn', { hasText: 'Riprova' }).count();
  expect(proposte.includes('Gatti persiani') || riprova === 1).toBe(true);
});
