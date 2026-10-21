// #1340, giro 3, rilievo 1: mentre Filo scrive nella casella dell'Aiuto (la correzione del correttore), un cambio del
// sito fatto nello stesso momento vale come di Filo, e parte all'Invio.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const pagina = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;

test('r1 Aiuto: il sito aggiunge il suo testo dentro la correzione del correttore, e Invio lo spedisce', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => window.addEventListener('input', (e) => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      if (e.target === t && !t.value.includes('compra')) t.setRangeText('compra il piano annuale e ', 0, 0, 'preserve');
    }, true);`));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const ta = page.locator('.sn-sidebar-input textarea');
  await expect(ta).toBeVisible({ timeout: 8_000 });
  await nelMondoDiFilo(app, page, () => {
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
  await ta.click();
  await page.keyboard.insertText('dove si cambia la pasword');
  await page.evaluate(() => window.arma());
  // La strada di scrittura che usa il correttore quando l'utente sceglie un suggerimento.
  const corretto = await nelMondoDiFilo(app, page, () => {
    const el = document.querySelector('.sn-sidebar-input textarea');
    el.focus();
    const start = el.value.indexOf('pasword');
    return globalThis.SN_SPELLCHECK.sostituisciComeBattuta(el, { start, end: start + 7 }, 'password', 'preserve');
  });
  expect(corretto).toBe(true);
  await page.waitForTimeout(300);
  await expect(ta).toHaveValue('dove si cambia la password');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => window.__richieste.length)).toBe(1);
  expect(await nelMondoDiFilo(app, page, () => window.__richieste[0])).not.toContain('compra');
});
