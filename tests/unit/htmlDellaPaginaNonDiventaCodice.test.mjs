// Un content script non rimette in pagina come HTML quello che legge da un attributo del documento: la pagina lo può
// scrivere da sé, e innerHTML lo farebbe girare con l'origine del sito (#2298).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'content');

const SCRITTURA_HTML = /(?:\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(|\.createContextualFragment\s*\(|document\.write(?:ln)?\s*\()/g;
const DAL_DOCUMENTO = /\bdataset\b|getAttribute(?:NS)?\s*\(|\.attributes\b/;

// Il pezzo a destra della scrittura, fino alla fine dell'istruzione.
function sorgentiDiHtml(testo) {
  const out = [];
  SCRITTURA_HTML.lastIndex = 0;
  let m;
  while ((m = SCRITTURA_HTML.exec(testo))) {
    const da = m.index + m[0].length;
    const fine = testo.indexOf(';', da);
    out.push({ riga: testo.slice(0, m.index).split('\n').length, valore: testo.slice(da, fine < 0 ? undefined : fine) });
  }
  return out;
}

test('la regola riconosce il ramo che rimetteva in pagina un attributo come HTML', () => {
  const vecchio = 'if (x) {\n  el.innerHTML = el.dataset.snOriginalHtml;\n}';
  assert.ok(sorgentiDiHtml(vecchio).some((s) => DAL_DOCUMENTO.test(s.valore)));
  assert.ok(sorgentiDiHtml('n.insertAdjacentHTML("beforeend", n.getAttribute("data-x"));').some((s) => DAL_DOCUMENTO.test(s.valore)));
  assert.ok(!sorgentiDiHtml('body.innerHTML = Popup.renderMarkdown(testo);').some((s) => DAL_DOCUMENTO.test(s.valore)));
});

test('nessun content script scrive come HTML un valore letto dagli attributi del documento', () => {
  const trovati = [];
  for (const nome of readdirSync(CONTENT).filter((f) => f.endsWith('.js'))) {
    const testo = readFileSync(join(CONTENT, nome), 'utf8');
    for (const s of sorgentiDiHtml(testo)) {
      if (DAL_DOCUMENTO.test(s.valore)) trovati.push(`${nome}:${s.riga}`);
    }
  }
  assert.deepEqual(trovati, []);
});

test('il ritorno all\'originale della traduzione non legge più i segni dei formati vecchi dal documento', () => {
  const testo = readFileSync(join(CONTENT, 'translatePage.js'), 'utf8');
  assert.doesNotMatch(testo, /snOriginalHtml|snOriginal\b|data-sn-original|data-sn-translation\b/);
});
