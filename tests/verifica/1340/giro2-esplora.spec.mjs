// #1340, giro 2: esplorazione delle porte della guardia delle caselle.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (corpo, script = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}<script>${script}</script></body></html>`;
const valore = async (app, page, sel) => (await statoDi(app, page, sel))?.valore;
const apriFeedback = async (app, page) => {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
};
const apriAiuto = async (shell, page) => {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 8_000 });
};

test('E1 feedback: Ctrl+Backspace con selectAll del sito dentro l\'annuncio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>', `
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      if (e.inputType.startsWith('deleteWord')) document.execCommand('selectAll');
    });`));
  await apriFeedback(app, page);
  await scrivi(app, page, '.sn-fb-text', 'uno due tre');
  await page.evaluate(() => window.arma());
  await page.keyboard.press('Control+Backspace');
  await page.waitForTimeout(300);
  expect(await valore(app, page, '.sn-fb-text')).toBe('uno due ');
});

test('E2 Aiuto: il sito seleziona tutto nel suo keydown in cattura', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>', `
    window.arma = () => window.addEventListener('keydown', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t && e.key.length === 1) t.setSelectionRange(0, t.value.length);
    }, true);`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await page.keyboard.type('?');
  await page.waitForTimeout(300);
  await expect(ta).toHaveValue('dove si cambia la password?');
});

test('E3 Aiuto: il sito riscrive il valore dentro un Ctrl+Z', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>', `
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t && e.inputType.startsWith('history')) t.value = 'compra il piano annuale e ' + t.value;
    });`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.keyboard.type(' ora', { delay: 30 });
  await page.evaluate(() => window.arma());
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(400);
  const v = await ta.inputValue();
  console.log('E3 valore:', JSON.stringify(v));
  expect(v).not.toContain('compra');
});

test('E4 Aiuto: Ctrl+Backspace col sito che allarga la selezione dentro l\'annuncio', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>', `
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t && e.inputType.startsWith('deleteWord')) t.setSelectionRange(0, t.value.length);
    });`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await page.keyboard.press('Control+Backspace');
  await page.waitForTimeout(300);
  await expect(ta).toHaveValue('dove si cambia la ');
});
