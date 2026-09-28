// Verifica #592 giro 13, rilievo 2: nell'Aiuto uno stile oltre il tetto è
// rifiutato, ma l'utente legge solo «non riuscita», senza il perché.
import { test, expect } from '../../fixtures/electron.mjs';
import { stileSalvato } from './giro13-comune.mjs';

test('Aiuto: lo stile troppo lungo è rifiutato e l’utente legge perché', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const max = await app.evaluate(() => globalThis.SN_CONST.AGENT_STYLE_MAX);
  const lungo = 'Rispondi con calma e con esempi. '.repeat(Math.ceil((max + 50) / 33)).trim();
  await page.evaluate((v) => window.__filoSidebarTest.runFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: v }), lungo);
  expect(await stileSalvato(app)).toBe('');
  await expect(page.locator('.sn-sidebar-log').last(), 'il rifiuto arriva muto: «non riuscita» senza il tetto')
    .toContainText(String(max), { timeout: 5_000 });
});
