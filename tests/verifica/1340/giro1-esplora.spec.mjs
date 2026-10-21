// #1340, giro 1: esplorazione delle caselle e dei bottoni dell'Aiuto sotto gli script del sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (corpo, script = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}<script>${script}</script></body></html>`;

const apriAiuto = async (shell, page) => {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 8_000 });
};
const spiaAiuto = (app, page) => nelMondoDiFilo(app, page, () => {
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

test('A: Aiuto, il sito riscrive il valore dentro il beforeinput dell\'utente (dopo Filo)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>', `
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t && !t.value.includes('compra')) t.value = 'compra il piano annuale e ' + t.value;
    });`));
  await apriAiuto(shell, page);
  await spiaAiuto(app, page);
  const ta = page.locator('.sn-sidebar-input textarea');
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password');
  await page.evaluate(() => window.arma());
  await page.keyboard.type('?');
  await page.waitForTimeout(300);
  const v = await ta.inputValue();
  console.log('A valore:', JSON.stringify(v));
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => window.__richieste.length)).toBe(1);
  const r = await nelMondoDiFilo(app, page, () => window.__richieste[0]);
  console.log('A inviato contiene compra:', r.includes('compra'));
  expect(v).toBe('dove si cambia la password?');
  expect(r).not.toContain('compra');
});

test('B: Backspace in testa e timeout del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p><textarea id="mia"></textarea>', `
    window.__eventi = [];
    window.arma = () => window.addEventListener('beforeinput', (e) => {
      window.__eventi.push(e.inputType);
      setTimeout(() => document.execCommand('insertText', false, ' SCRITTO DAL SITO'), 0);
    }, true);
    window.addEventListener('input', (e) => window.__eventi.push('input:' + e.inputType), true);`));
  await nelMondoDiFilo(app, page, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'submit_feedback') return Promise.resolve({ ok: true, id: 'x' });
      return orig(m, ...r);
    };
    return globalThis.SN_FEEDBACK_UI.open();
  });
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro');
  await page.keyboard.press('Home');
  await page.evaluate(() => window.arma());
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  console.log('B eventi:', JSON.stringify(await page.evaluate(() => window.__eventi)));
  const v = (await statoDi(app, page, '.sn-fb-text')).valore;
  console.log('B valore:', JSON.stringify(v));
  expect(v).toBe('Il tasto indietro');
});

test('C: IME nella casella del feedback e nell\'Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Un sito</p>'));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'ciao ');
  const s = await page.context().newCDPSession(page);
  await s.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await s.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  await s.send('Input.insertText', { text: '日本' });
  await page.waitForTimeout(300);
  const v = (await statoDi(app, page, '.sn-fb-text')).valore;
  console.log('C feedback:', JSON.stringify(v));
  expect(v).toBe('ciao 日本');
});

test('D: microfono dell\'Aiuto preso col fuoco dal sito e premuto con Spazio sotto il velo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<h1>Un sito</h1>', `
    window.stendi = () => { const v = document.createElement('div'); v.id='velo'; v.style.cssText='position:fixed;inset:0;background:#fff;pointer-events:none;z-index:2147483647'; v.textContent='Premi spazio per continuare'; document.body.appendChild(v); };
    window.fuoco = () => document.querySelector('.sn-sidebar .sn-voce-btn').focus();`));
  await apriAiuto(shell, page);
  await nelMondoDiFilo(app, page, () => {
    globalThis.__ascolti = 0;
    globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
    return true;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.stendi(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.fuoco());
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const n = await nelMondoDiFilo(app, page, () => globalThis.__ascolti);
  console.log('D ascolti:', n);
  expect(n).toBe(0);
});
