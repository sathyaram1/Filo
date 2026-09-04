// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

test('Opzioni: nessun Google/Gemini fra fornitori e chiavi', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);

  const dump = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input,select,textarea')].map((el) => ({
      id: el.id, name: el.name, type: el.type,
      placeholder: el.placeholder || '',
      label: (el.closest('label')?.textContent || '').trim().slice(0, 80),
    }));
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      id: s.id, options: [...s.options].map((o) => o.value + '|' + o.textContent.trim()),
    }));
    return {
      inputs,
      selects,
      bodyText: document.body.innerText,
      html: document.body.innerHTML,
    };
  });

  const badText = (dump.bodyText.match(/.{0,60}(gemini|google).{0,60}/gi) || []);
  const badHtml = (dump.html.match(/.{0,80}(gemini|google).{0,80}/gi) || []);
  console.log('=== INPUTS ===\n' + JSON.stringify(dump.inputs, null, 1));
  console.log('=== SELECTS ===\n' + JSON.stringify(dump.selects, null, 1));
  console.log('=== TESTO con google/gemini ===\n' + badText.join('\n---\n'));
  console.log('=== HTML con google/gemini ===\n' + badHtml.join('\n---\n'));
});
