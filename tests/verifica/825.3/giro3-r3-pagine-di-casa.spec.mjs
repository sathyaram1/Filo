// Giro 3, rilievo 3: le pagine archiviate della rete di casa non compaiono mai nel
// pannello, e il pannello dice che nessuna scheda riguarda la richiesta.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('una pagina della rete di casa che riguarda la richiesta si propone, o il pannello dice che non l\'ha guardata', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, [
    { title: 'Telecamera dei gatti', gatto: true, url: 'http://192.168.1.20/' },
    { title: 'Torta', gatto: false },
  ], { chiamate: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] });
  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  const note = panel.locator('.dash-delete-note');
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note).not.toHaveAttribute('data-cerco', '1', { timeout: 15_000 });
  await expect(note).not.toHaveText('', { timeout: 5_000 });
  const proposte = await panel.locator('.dash-delete-list li').allTextContents();
  const testo = await note.textContent();
  expect(proposte.includes('Telecamera dei gatti') || /casa/i.test(testo)).toBe(true);
});
