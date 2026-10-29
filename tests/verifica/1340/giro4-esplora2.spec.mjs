import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const paginaS = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;
async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

test('e1 Aiuto: il sito seleziona tutto all\'inizio di una composizione vera', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaS(`
    window.arma = () => document.addEventListener('compositionstart', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.isTrusted) t.setSelectionRange(0, t.value.length);
    }, true);`));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password ');
  await page.evaluate(() => window.arma());
  const s = await page.context().newCDPSession(page);
  await s.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await s.send('Input.insertText', { text: '日本' });
  await page.waitForTimeout(400);
  console.log('e1', JSON.stringify(await ta.inputValue()));
});

test('e2 feedback: il sito seleziona tutto all\'inizio di una composizione vera', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaS(`
    window.arma = () => document.addEventListener('compositionstart', (e) => { if (e.isTrusted) document.execCommand('selectAll'); }, true);`));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va ');
  await page.evaluate(() => window.arma());
  const s = await page.context().newCDPSession(page);
  await s.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await s.send('Input.insertText', { text: '日本' });
  await page.waitForTimeout(400);
  console.log('e2', JSON.stringify((await statoDi(app, page, '.sn-fb-text'))?.valore));
});

test('e3 aspetto: Aiuto spostato, sottolineature e avviso', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaS(''));
  await apriAiuto(shell, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.type('dove si canbia la pasword');
  await page.waitForTimeout(2500);
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 120, h.y + h.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('L\'Aiuto era coperto: clic ignorato', { duration: 8000 }); return true; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/g4-e3.png' });
});
