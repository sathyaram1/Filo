// Sentinella #2388: in Filo il corsivo vuol dire «qui c'è una spiegazione al passaggio», e nient'altro. Nessun foglio
// di stile di Filo (file .css e <style> delle pagine) né uno stile scritto da script inclina il testo fuori dalle classi
// delle spiegazioni; il corsivo del modello senza spiegazione esce dritto, e le pagine raddrizzano i tag che il browser inclina.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
// Le parole con la spiegazione al passaggio: quelle delle risposte e le glosse della pagina Trasparenza.
const CONVENZIONE = /\.filo-spiega\b|\.sn-gloss\b/;

function file(dir, est, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) file(p, est, acc);
    else if (est.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}

// Ogni dichiarazione font-style: italic|oblique con il selettore della regola che la contiene.
function corsivi(css) {
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /font-style\s*:\s*(italic|oblique)/gi;
  let m;
  while ((m = re.exec(senzaCommenti))) {
    const graffa = senzaCommenti.lastIndexOf('{', m.index);
    const prima = Math.max(senzaCommenti.lastIndexOf('}', graffa), senzaCommenti.lastIndexOf(';', graffa));
    out.push({ selettore: senzaCommenti.slice(prima + 1, graffa).trim(), riga: senzaCommenti.slice(0, m.index).split('\n').length });
  }
  return out;
}

const fogli = () => [
  ...file(SRC, ['.css']).map((p) => ({ p, css: readFileSync(p, 'utf8') })),
  ...file(SRC, ['.html']).flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((s) => ({ p, css: s[1] }))),
];

test('#2388 nessun foglio di stile di Filo usa il corsivo fuori dalle spiegazioni al passaggio', () => {
  const fuori = [];
  let dentro = 0;
  for (const { p, css } of fogli()) {
    for (const c of corsivi(css)) {
      if (CONVENZIONE.test(c.selettore)) dentro++;
      else fuori.push(`${relative(ROOT, p).replace(/\\/g, '/')}:${c.riga} «${c.selettore}»`);
    }
  }
  assert.deepEqual(fuori, [], 'corsivo fuori convenzione: va dritto, nel suo grigio se è una riga di servizio');
  assert.ok(dentro >= 1, 'la regola del corsivo delle spiegazioni manca');
});

test('#2388 la sentinella riconosce un corsivo fuori convenzione', () => {
  assert.deepEqual(corsivi('.a { color: red; }\n.b,\n.c { font-style: italic; }').map((c) => c.selettore), ['.b,\n.c']);
  assert.equal(CONVENZIONE.test(corsivi('/* x { */ .filo-spiega { font-style: italic }')[0].selettore), true);
});

test('#2388 nessuno script di Filo scrive uno stile in corsivo', () => {
  const fuori = [];
  for (const p of file(SRC, ['.js'])) {
    const testo = readFileSync(p, 'utf8');
    if (/fontStyle\s*=\s*['"`](italic|oblique)|font-style\s*:\s*(italic|oblique)/i.test(testo)) fuori.push(relative(ROOT, p));
  }
  assert.deepEqual(fuori, []);
});

test('#2388 le pagine di Filo raddrizzano i tag che il browser inclina, e il corsivo del modello esce dritto', () => {
  const pagine = readFileSync(join(SRC, 'styles', 'pages.css'), 'utf8');
  assert.match(pagine, /(^|\n)em, i, cite, dfn, var, address \{ font-style: normal; \}/);
  const require = createRequire(import.meta.url);
  require(join(SRC, 'shared', 'filoMarkdown.js'));
  assert.equal(globalThis.SN_MARKDOWN.render('Una *parola* qui'), '<p>Una parola qui</p>');
});
