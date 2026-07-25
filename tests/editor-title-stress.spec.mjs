// Verifier stress test #379.4 — non committare (traccia di run).
import { test, expect } from './fixtures/electron.mjs';

async function stubAI(page, initialTitle) {
  await page.evaluate((title) => {
    window.__titleReply = title;
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = [];
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        window.__aiCalls.push(msg);
        r = window.__titleReply === '__FAIL__' ? { ok: false } : { ok: true, text: window.__titleReply };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) { if (typeof cb === 'function') { cb(r); return undefined; } return Promise.resolve(r); }
      return orig(msg, cb);
    };
  }, initialTitle);
}
function longText(words) {
  const base = ['il','giardino','in','primavera','fiorisce','con','colori','vivaci','e','profumi'];
  const out = []; for (let i=0;i<words;i++) out.push(base[i%base.length]); return out.join(' ');
}
async function typeDoc(page, txt) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + t + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, txt);
}

test('un titolo dato a mano NON viene sovrascritto dall\'auto-titolo a 100 parole', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, 'Titolo AI Indesiderato');
  // Rinomina a mano.
  await page.click('#docSwitch', { button: 'right' });
  await page.locator('.ed-title-ctxmenu').getByText('Rinomina', { exact: true }).click();
  const input = page.locator('.ed-doc-title-input');
  await input.fill('Nome Mio');
  await input.press('Enter');
  await expect(page.locator('#docTitle')).toHaveText('Nome Mio');
  // Ora scrive oltre 100 parole: l'auto-titolo NON deve scattare.
  await typeDoc(page, longText(140));
  await page.waitForTimeout(600);
  await expect(page.locator('#docTitle')).toHaveText('Nome Mio');
  expect(await page.evaluate(() => window.__aiCalls.length)).toBe(0);
});

test('titolo con HTML/script non viene eseguito (mostrato come testo)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => { window.__xss = false; window.__xssMark = () => { window.__xss = true; }; });
  await stubAI(page, '<img src=x onerror=window.__xssMark()><script>window.__xssMark()</script>Hack');
  await typeDoc(page, longText(120));
  await page.waitForTimeout(600);
  // Nessuna esecuzione di script.
  expect(await page.evaluate(() => window.__xss)).toBe(false);
  // Il titolo mostrato è testo puro, senza nodi figli iniettati.
  const kids = await page.evaluate(() => document.getElementById('docTitle').children.length);
  expect(kids).toBe(0);
  const txt = await page.locator('#docTitle').textContent();
  expect(txt).not.toBe('Documento senza titolo');
  expect(txt.length).toBeLessThanOrEqual(80);
});

test('AI fallita in auto: resta il default, non spamma chiamate e Rigenera funziona dopo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, '__FAIL__');
  await typeDoc(page, longText(120));
  await page.waitForTimeout(500);
  // Auto fallita: titolo di default, nessun toast rumoroso, una sola chiamata.
  await expect(page.locator('#docTitle')).toHaveText('Documento senza titolo');
  expect(await page.evaluate(() => window.__aiCalls.length)).toBe(1);
  // Continua a scrivere: NON ritenta in automatico (già segnato come tentato).
  await typeDoc(page, longText(160));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__aiCalls.length)).toBe(1);
  // Ma Rigenera dal menu resta sempre disponibile e ora funziona.
  await page.evaluate(() => { window.__titleReply = 'Recuperato a mano'; });
  await page.click('#docSwitch', { button: 'right' });
  await page.locator('.ed-title-ctxmenu').getByText('Rigenera titolo', { exact: true }).click();
  await expect(page.locator('#docTitle')).toHaveText('Recuperato a mano', { timeout: 8000 });
});

test('titolo AI di soli spazi/vuoto non azzera il titolo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, '   \n  ');
  await typeDoc(page, longText(120));
  await page.waitForTimeout(600);
  await expect(page.locator('#docTitle')).toHaveText('Documento senza titolo');
});

test('Duplica file crea copia e non rigenera; il duplicato ha "(copia)"', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, 'Giardino Fiorito');
  await typeDoc(page, longText(120));
  await expect(page.locator('#docTitle')).toHaveText('Giardino Fiorito', { timeout: 8000 });
  const before = await page.evaluate(() => window.__aiCalls.length);
  await page.click('#docSwitch', { button: 'right' });
  await page.locator('.ed-title-ctxmenu').getByText('Duplica file', { exact: true }).click();
  await expect(page.locator('#docTitle')).toHaveText('Giardino Fiorito (copia)');
  // Scrivere ancora nel duplicato non deve far scattare l'auto-titolo.
  await typeDoc(page, longText(160));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__aiCalls.length)).toBe(before);
});
