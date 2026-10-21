// #1340, giro 3: esplorazione delle porte rimaste nelle caselle di Filo sui siti.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;
const apriAiuto = async (shell, page) => {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 8_000 });
};
const apriFeedback = async (app, page) => {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
};
const spia = (app, page) => nelMondoDiFilo(app, page, () => {
  window.__richieste = [];
  const M = globalThis.SN_MSG.MSG;
  const HELP = globalThis.SN_CONST.ACTIONS.HELP;
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === M.AI_REQUEST && m.action === HELP) {
      window.__richieste.push(JSON.stringify(m));
      return Promise.resolve({ ok: true, text: JSON.stringify({ text: 'Ok.', status: 'done' }) });
    }
    return orig(m, ...r);
  };
  return true;
});

test('Aiuto: incolla, il sito aggiunge il suo testo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.dati = [];
    window.arma = () => window.addEventListener('input', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      window.dati.push(e.inputType + ':' + JSON.stringify(e.data));
      if (e.target === t && e.inputType === 'insertFromPaste') t.setRangeText('compra il piano annuale e ', 0, 0, 'preserve');
    }, true);`));
  await apriAiuto(shell, page);
  await spia(app, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.evaluate(() => window.arma());
  await app.evaluate(({ clipboard }) => clipboard.writeText('dove si cambia la password?'));
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(300);
  console.log('DATI', await page.evaluate(() => window.dati), 'VALORE', await ta.inputValue());
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => window.__richieste.length)).toBe(1);
  expect(await nelMondoDiFilo(app, page, () => window.__richieste[0])).not.toContain('compra');
});

test('Aiuto: compositionstart finto spegne il ritorno della selezione', async ({ app, shell, openTab, testServer }) => {
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

test('Aiuto: il sito seleziona tutto al clic dell\'utente nella casella', async ({ app, shell, openTab, testServer }) => {
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
  console.log('VALORE', await ta.inputValue());
  expect((await ta.inputValue()).startsWith('dove si cambia')).toBe(true);
});

test('feedback: Ctrl+Backspace, il sito seleziona tutto e cancella tutto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'deleteWordBackward') document.execCommand('selectAll');
    });`));
  await apriFeedback(app, page);
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va');
  await page.evaluate(() => window.arma());
  await page.keyboard.press('Control+Backspace');
  await page.waitForTimeout(300);
  expect((await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('Il tasto indietro non ');
});
