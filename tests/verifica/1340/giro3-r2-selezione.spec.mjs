// #1340, giro 3, rilievo 2: il sito sposta la selezione nelle caselle di Filo fuori dai momenti che la guardia
// controlla (il clic dell'utente) o la spegne con un inizio di composizione finto, e il tasto dopo cancella il testo.
// Riscritta al giro 5 (D-116): le caselle stanno nello strato sopra la scheda, il sito le cerca e attacca da casa sua.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi, clicca, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const pagina = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;
const CASELLE = `const caselle = () => document.querySelectorAll('textarea, input, [contenteditable]');`;
const apriAiuto = async (app, shell, page) => {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 10_000 });
  return strato;
};

test('Aiuto: un inizio di composizione finto spegne il ritorno della selezione, e il carattere dell\'utente cancella la domanda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`${CASELLE}
    window.arma = () => {
      for (const t of caselle()) t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      window.addEventListener('keydown', () => { for (const t of caselle()) t.setSelectionRange?.(0, t.value.length); document.execCommand('selectAll'); }, true);
      return caselle().length;
    };`));
  const strato = await apriAiuto(app, shell, page);
  const ta = strato.locator('.sn-sidebar-input textarea');
  await ta.click();
  await strato.keyboard.insertText('dove si cambia la password');
  expect(await page.evaluate(() => window.arma()), 'il sito non trova la casella').toBe(0);
  await strato.keyboard.type('?');
  await page.waitForTimeout(300);
  await expect(ta).toHaveValue('dove si cambia la password?');
});

test('Aiuto: il sito seleziona tutto al clic dell\'utente nella casella, e il carattere dopo cancella la domanda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`${CASELLE}
    window.arma = () => { for (const t of ['mousedown', 'click', 'focusin']) window.addEventListener(t, () => {
      for (const c of caselle()) c.setSelectionRange?.(0, c.value.length);
      document.execCommand('selectAll');
    }, true); return true; };`));
  const strato = await apriAiuto(app, shell, page);
  const ta = strato.locator('.sn-sidebar-input textarea');
  await ta.click();
  await strato.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await ta.click();
  await strato.keyboard.type('?');
  await page.waitForTimeout(300);
  // Il carattere cade dove l'utente ha cliccato: conta che il resto del testo resti intero (decisione owner, D-116).
  const v = await ta.inputValue();
  expect(v.length).toBe('dove si cambia la password'.length + 1);
  expect(v.replace('?', '')).toBe('dove si cambia la password');
});

test('feedback: il sito seleziona tutto al clic dell\'utente nella casella, e il carattere dopo cancella il testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => { for (const t of ['mousedown', 'click', 'focusin']) window.addEventListener(t, () => { document.execCommand('selectAll'); }, true); return true; };`));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const dove = await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va');
  await page.evaluate(() => window.arma());
  await clicca(app, page, '.sn-fb-text');
  await dove.keyboard.type('!');
  await page.waitForTimeout(300);
  const v = (await statoDi(app, page, '.sn-fb-text'))?.valore || '';
  expect(v.length).toBe('Il tasto indietro non va'.length + 1);
  expect(v.replace('!', '')).toBe('Il tasto indietro non va');
});
