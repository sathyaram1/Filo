// #1340, giro 3, rilievo 2: il sito sposta la selezione nelle caselle di Filo fuori dai momenti che la guardia
// controlla (il clic dell'utente) o la spegne con un inizio di composizione finto, e il tasto dopo cancella il testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;
const apriAiuto = async (shell, page) => {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 8_000 });
};

test('r2 Aiuto: un inizio di composizione finto spegne il ritorno della selezione, e il carattere dell\'utente cancella la domanda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      window.addEventListener('keydown', (e) => {
        if (e.target === t && e.key.length === 1) t.setSelectionRange(0, t.value.length);
      }, true);
    };`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await page.keyboard.type('?');
  await page.waitForTimeout(300);
  await expect(ta).toHaveValue('dove si cambia la password?');
});

test('r2 Aiuto: il sito seleziona tutto al clic dell\'utente nella casella, e il carattere dopo cancella la domanda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => window.addEventListener('click', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t) t.setSelectionRange(0, t.value.length);
    }, true);`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await ta.click();
  await page.keyboard.type('?');
  await page.waitForTimeout(300);
  // Il carattere cade dove l'utente ha cliccato: conta che il resto del testo resti intero (decisione owner, D-116).
  const v = await ta.inputValue();
  expect(v.length).toBe('dove si cambia la password'.length + 1);
  expect(v.replace('?', '')).toBe('dove si cambia la password');
});

test('r2 feedback: il sito seleziona tutto al clic dell\'utente nella casella, e il carattere dopo cancella il testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => window.addEventListener('click', () => { document.execCommand('selectAll'); }, true);`));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va');
  const r = await nelMondoDiFilo(app, page, () => { const b = globalThis.SN_FILO_UI._test.trova('.sn-fb-text').getBoundingClientRect(); return { x: b.x + 20, y: b.y + 10 }; });
  await page.evaluate(() => window.arma());
  await page.mouse.click(r.x, r.y);
  await page.keyboard.type('!');
  await page.waitForTimeout(300);
  expect(((await statoDi(app, page, '.sn-fb-text'))?.valore || '').startsWith('Il tasto indietro')).toBe(true);
});
