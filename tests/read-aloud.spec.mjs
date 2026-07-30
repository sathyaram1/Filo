// Feedback alpha: aggiungere l'opzione "Leggi" (text-to-speech) accessibile dal
// menu del tasto destro su una selezione di testo.
//
// Asserisce IL SUCCESSO della feature, non l'assenza di un errore:
//   1. selezionando del testo e aprendo il menu Filo compare la voce "🔊 Leggi";
//   2. cliccandola, il content script avvia la lettura del testo selezionato
//      (osservato tramite l'evento DOM 'filo:read-aloud' con il testo giusto).
//
// La verifica usa l'evento DOM perché nel CI headless non c'è un motore vocale
// del sistema: ciò che conta è che l'azione "Leggi" parta sul testo corretto.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
  <h1>Pagina di prova</h1>
  <p id="target">Questo è il testo che Filo deve leggere ad alta voce.</p>
</body></html>`;

test('selezionando testo, il menu mostra "Leggi" e cliccarlo avvia la lettura del testo selezionato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Installa un osservatore dell'evento di lettura sul document (DOM condiviso
  // tra il mondo della pagina e quello del content script).
  await page.evaluate(() => {
    window.__filoReadAloud = [];
    document.addEventListener('filo:read-aloud', (e) => {
      window.__filoReadAloud.push(e.detail && e.detail.text);
    });
  });

  // Seleziona l'intero paragrafo.
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // Apre il menu Filo con il tasto destro sulla selezione.
  await page.locator('#target').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // La voce "Leggi" è presente.
  const readItem = menu.locator('.sn-menu-label', { hasText: 'Leggi' }).first();
  await expect(readItem).toBeVisible();

  // Cliccandola, parte la lettura del testo selezionato.
  await readItem.click();

  await expect
    .poll(() => page.evaluate(() => window.__filoReadAloud || []), { timeout: 4000 })
    .toEqual(['Questo è il testo che Filo deve leggere ad alta voce.']);

  // Nei test non c'è una chiave Gemini, quindi la voce a modello non è
  // disponibile e la lettura ripiega su quella del browser. Prima questo ripiego
  // era MUTO ("modello impostato ma lettura automatica" restava un mistero):
  // ora Filo lo dice con un toast. Asseriamo che l'avviso compaia davvero.
  await expect(
    page.locator('.sn-toast', { hasText: 'voce del browser' })
  ).toBeVisible({ timeout: 4000 });
});
