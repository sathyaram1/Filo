// Sonda: la scorciatoia di modulo dell'Editor accetta combinazioni che su
// QUESTO sistema (Windows/Linux) Filo si prende comunque?
import { test, expect } from './fixtures/electron.mjs';

test('sonda: quali combinazioni il campo scorciatoia rifiuta su Windows/Linux', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  const esito = await page.evaluate(() => {
    const T = window.SN_TASTI;
    const prova = ['Ctrl+0', 'Ctrl+Z', 'Ctrl+B', 'Ctrl+W', 'Ctrl+-', 'Alt+3', 'Alt+E', 'Ctrl+Shift+1', 'Ctrl+C'];
    const out = {};
    for (const p of prova) out[p] = { win: T.riservato(p, 'win32'), mac: T.riservato(p, 'darwin') };
    return out;
  });
  console.log('RISERVATO:', JSON.stringify(esito, null, 1));
});
