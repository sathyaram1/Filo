// #379.4 — titolo del file generato automaticamente dal contenuto.
//
// Verifica il COMPORTAMENTO (non un messaggio):
//  1) scrivendo oltre ~100 parole in un documento senza nome, Filo propone da
//     solo un titolo NON vuoto e coerente col contenuto (l'AI è mockata);
//  2) il tasto destro sul titolo apre un menu contestuale che espone
//     "Rigenera titolo" (più rinomina/duplica/elimina), e rigenerare cambia il
//     titolo anche sotto le 100 parole;
//  3) (#403) aprire la rinomina e confermarla SENZA dare un nome lascia il
//     documento senza nome, ma NON spegne il titolo automatico: dopo 100 parole
//     il titolo arriva lo stesso. Vale per entrambi i cammini di rinomina
//     (matita nel menu documenti e "Rinomina" dal tasto destro sul titolo).
//
// L'AI è stubbata sovrascrivendo chrome.runtime.sendMessage nella pagina (lo
// shim è writable), così AI_REQUEST torna un titolo canonico e FILO_GET_MEMORY
// una memoria vuota — nessuna chiave modello richiesta.

import { test, expect } from './fixtures/electron.mjs';

// Installa lo stub AI e restituisce un modo per cambiare la risposta del titolo.
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
        r = { ok: true, text: window.__titleReply };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        if (typeof cb === 'function') { cb(r); return undefined; }
        return Promise.resolve(r);
      }
      return orig(msg, cb);
    };
  }, initialTitle);
}

function longText(words) {
  const base = ['il', 'giardino', 'in', 'primavera', 'fiorisce', 'con', 'colori', 'vivaci', 'e', 'profumi'];
  const out = [];
  for (let i = 0; i < words; i++) out.push(base[i % base.length]);
  return out.join(' ');
}

test('oltre 100 parole il documento senza nome riceve un titolo automatico', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'Il giardino in primavera');

  // Precondizione: il titolo è ancora quello di default.
  await expect(page.locator('#docTitle')).toHaveText('Documento senza titolo');

  // Scrive oltre 100 parole e notifica l'editor (evento input).
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(120));

  // Il titolo diventa quello proposto dall'AI (non vuoto, coerente col mock).
  await expect(page.locator('#docTitle')).toHaveText('Il giardino in primavera', { timeout: 8000 });

  // È partita esattamente una richiesta AI per il titolo (una volta sola).
  const calls = await page.evaluate(() => window.__aiCalls.length);
  expect(calls).toBe(1);

  // Continuando a scrivere NON si rigenera (once-only).
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + ' altre parole ancora aggiunte qui</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(140));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__aiCalls.length)).toBe(1);
});

test('il tasto destro sul titolo apre il menu con "Rigenera titolo"', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, 'Titolo rigenerato');

  // Tasto destro sul selettore documento → menu contestuale del titolo.
  await page.click('#docSwitch', { button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Rigenera titolo', { exact: true })).toHaveCount(1);
  await expect(menu.getByText('Rinomina', { exact: true })).toHaveCount(1);
  await expect(menu.getByText('Duplica file', { exact: true })).toHaveCount(1);
  await expect(menu.getByText('Elimina file', { exact: true })).toHaveCount(1);

  // Scrive un po' di testo (sotto le 100 parole: niente auto-titolo) così il
  // documento non è vuoto, poi rigenera dal menu.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>una breve nota di prova sul giardino</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await menu.getByText('Rigenera titolo', { exact: true }).click();

  // Il titolo diventa quello rigenerato dall'AI.
  await expect(page.locator('#docTitle')).toHaveText('Titolo rigenerato', { timeout: 8000 });
});
