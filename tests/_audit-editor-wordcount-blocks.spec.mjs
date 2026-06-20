// AUDIT (routine, throwaway): il conteggio parole dell'editor usa
// docEl.textContent, che concatena i blocchi (p, li, h…) SENZA separatore.
// Risultato: l'ultima parola di un blocco e la prima del blocco successivo si
// fondono in una sola, quindi il conteggio parole è sbagliato (sottostima)
// su qualunque documento multi-paragrafo o lista.
import { test, expect } from './fixtures/electron.mjs';

test('editor word-count: parole fuse tra paragrafi/elementi (sottostima)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');

  // Scrive come un utente reale: 4 righe separate da Invio → 6 parole vere.
  // (Invio in contenteditable crea blocchi separati: p/div.)
  await page.keyboard.type('Hello world');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Foo bar');
  await page.keyboard.press('Enter');
  await page.keyboard.type('apple');
  await page.keyboard.press('Enter');
  await page.keyboard.type('banana');
  await page.waitForTimeout(200);

  const stats = await page.evaluate(() => {
    const docEl = document.getElementById('doc');
    const text = (docEl.textContent || '').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return { textContent: docEl.textContent, words };
  });
  console.log('textContent >>>', JSON.stringify(stats.textContent));
  console.log('WORDS COUNTED >>>', stats.words, '(reali: 6)');

  // Apri l'overlay "Statistiche documento" cliccando il modulo conteggio parole,
  // così lo screenshot mostra il numero sbagliato come lo vede l'utente.
  const wc = page.locator('.ed-module[data-type="word-count"]').first();
  if (await wc.count()) {
    await wc.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: 'tests/.shots/audit-wordcount-blocks.png' }).catch(() => {});

  // Le 6 parole reali vengono contate male perché i blocchi si fondono:
  // "worldFoo" e "barapple"/"applebanana" diventano una parola sola.
  expect(stats.words).toBeLessThan(6); // riproduce la sottostima
});
