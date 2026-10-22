// Verifica #1449 giro 2, rilievo 3: negli editor a blocchi (un paragrafo modificabile per riga, come WordPress o
// Notion) «Valuta» giudica solo il paragrafo sotto il mouse, non il testo che l'utente sta scrivendo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { prepara, parere } from './_prepara.mjs';

test('r3 in un editor a blocchi «Valuta» manda al modello tutto il testo, non un paragrafo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', parere({ text: 'ok' })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><div class="editor"><h1 contenteditable="true">Il mio viaggio</h1><p contenteditable="true">Primo paragrafo del post.</p><p id="p2" contenteditable="true">Secondo paragrafo con un erore.</p><p contenteditable="true">Terzo paragrafo finale.</p></div>');
  await page.locator('#p2').click({ button: 'right' });
  await menuDi(page).voce('Valuta').click();
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('ok', { timeout: 15_000 });
  const inviato = (await app.evaluate(() => globalThis.__chiamate)).at(-1);
  expect(inviato).toContain('Primo paragrafo del post.');
  expect(inviato).toContain('Secondo paragrafo con un erore.');
  expect(inviato).toContain('Terzo paragrafo finale.');
});
