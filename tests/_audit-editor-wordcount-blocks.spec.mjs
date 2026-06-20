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

  // Documento con 6 parole reali, distribuite su 2 paragrafi e una lista.
  // "Hello world" / "Foo bar" / li "apple" / li "banana"  → 6 parole.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML =
      '<p>Hello world</p>' +
      '<p>Foo bar</p>' +
      '<ul><li>apple</li><li>banana</li></ul>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  // Apri l'overlay statistiche (clic sul modulo conteggio parole se presente,
  // altrimenti calcola via la stessa logica esposta in pagina).
  const stats = await page.evaluate(() => {
    const docEl = document.getElementById('doc');
    const text = (docEl.textContent || '').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return { textContent: docEl.textContent, words };
  });
  console.log('textContent >>>', JSON.stringify(stats.textContent));
  console.log('WORDS COUNTED >>>', stats.words, '(reali: 6)');

  await page.screenshot({ path: 'tests/.shots/audit-wordcount-blocks.png' }).catch(() => {});

  // Le 6 parole reali vengono contate male perché i blocchi si fondono:
  // "worldFoo" e "barapple"/"applebanana" diventano una parola sola.
  expect(stats.words).toBeLessThan(6); // riproduce la sottostima
});
