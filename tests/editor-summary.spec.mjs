// #379.5 — riassunto per file, mantenuto aggiornato, come contesto per Filo.
//
// Verifica il COMPORTAMENTO (non un messaggio):
//  1) scrivendo abbastanza testo in un documento, Filo genera da solo un
//     RIASSUNTO e lo SALVA nel file (meta.summary): è ciò che poi entra nel
//     contesto di Filo al posto del testo integrale;
//  2) il riassunto si RIGENERA quando il file cambia in modo significativo
//     (a differenza del titolo, una-tantum);
//  3) il tasto destro sul titolo espone "Rigenera riassunto" e rigenerarlo
//     aggiorna il riassunto salvato.
//
// L'AI è stubbata sovrascrivendo chrome.runtime.sendMessage nella pagina (lo
// shim è writable): AI_REQUEST torna un riassunto canonico, FILO_GET_MEMORY una
// memoria vuota — nessuna chiave modello richiesta.

import { test, expect } from './fixtures/electron.mjs';

const COLLECTION_KEY = 'filo.editor.collection';

async function stubAI(page, initialSummary) {
  await page.evaluate((summary) => {
    window.__summaryReply = summary;
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = [];
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        window.__aiCalls.push(msg);
        r = { ok: true, text: window.__summaryReply };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        if (typeof cb === 'function') { cb(r); return undefined; }
        return Promise.resolve(r);
      }
      return orig(msg, cb);
    };
  }, initialSummary);
}

function longText(words, marker) {
  const base = ['il', 'progetto', 'di', 'ricerca', 'analizza', 'i', 'dati', 'raccolti', 'sul', 'campo'];
  const out = [];
  for (let i = 0; i < words; i++) out.push(marker ? `${marker}${i}` : base[i % base.length]);
  return out.join(' ');
}

function activeSummary(page) {
  return page.evaluate((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return (f && f.meta && f.meta.summary) || null;
    } catch (_) { return null; }
  }, COLLECTION_KEY);
}

test('scrivendo abbastanza testo Filo genera e SALVA un riassunto del file', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'Un progetto di ricerca sui dati raccolti sul campo.');

  // Precondizione: nessun riassunto salvato.
  expect(await activeSummary(page)).toBeNull();

  // Scrive abbastanza testo e notifica l'editor (evento input): scatta il tiro
  // automatico (con debounce), che chiama l'AI e salva il riassunto.
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(90));

  // Il riassunto proposto dall'AI viene salvato nel file (contesto per Filo).
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return !!(f && f.meta && f.meta.summary);
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  expect(await activeSummary(page)).toBe('Un progetto di ricerca sui dati raccolti sul campo.');
});

test('il riassunto si rigenera quando il file cambia in modo significativo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'Primo riassunto.');

  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(90, 'x'));
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Primo riassunto.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  const firstCalls = await page.evaluate(() => window.__aiCalls.length);

  // Cambia molto il contenuto (molte parole in più): supera la soglia di
  // "cambiamento significativo" e il riassunto si rigenera.
  await page.evaluate(() => { window.__summaryReply = 'Secondo riassunto aggiornato.'; });
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(200, 'y'));
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Secondo riassunto aggiornato.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  expect(await page.evaluate(() => window.__aiCalls.length)).toBeGreaterThan(firstCalls);
});

test('il tasto destro sul titolo espone "Rigenera riassunto" e rigenerarlo aggiorna il riassunto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, 'Riassunto rigenerato a mano.');

  await page.click('#docSwitch', { button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Rigenera riassunto', { exact: true })).toHaveCount(1);

  // Scrive un po' di testo, poi rigenera il riassunto dal menu (nessuna soglia).
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>una breve nota di prova sul progetto di ricerca</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await menu.getByText('Rigenera riassunto', { exact: true }).click();

  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Riassunto rigenerato a mano.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 8000 });
  expect(await activeSummary(page)).toBe('Riassunto rigenerato a mano.');
});
