// #1509 — Un avviso nato nel main che non riguarda la pagina (allegati non saliti, chiave, crediti, fornitore escluso)
// sta nella barra di Filo: scritto nel documento del sito davanti, il sito lo leggeva. Alla pagina va solo l'avviso
// della pagina stessa, a una scheda (spingiAllaScheda). Il comportamento lo prova tests/avvisi-di-filo-nella-barra.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function* sorgenti(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* sorgenti(p);
    else if (n.endsWith('.js')) yield p;
  }
}

// Gli argomenti di ogni chiamata a `nome(`, con le parentesi bilanciate.
function chiamate(testo, nome) {
  const out = [];
  const re = new RegExp(`\\b${nome}\\s*\\(`, 'g');
  for (let m = re.exec(testo); m; m = re.exec(testo)) {
    let i = m.index + m[0].length;
    let fondo = 1;
    const da = i;
    for (; i < testo.length && fondo > 0; i++) {
      if (testo[i] === '(') fondo++;
      else if (testo[i] === ')') fondo--;
    }
    out.push({ da: m.index, a: i, corpo: testo.slice(da, i - 1) });
  }
  return out;
}

const FILE_MAIN = [...sorgenti(join(ROOT, 'src', 'main'))].map((p) => ({ rel: relative(ROOT, p), testo: readFileSync(p, 'utf8') }));

test('in src/main nessun broadcastToTabs porta SHOW_TOAST', () => {
  const colpevoli = [];
  for (const { rel, testo } of FILE_MAIN) {
    for (const c of chiamate(testo, 'broadcastToTabs')) {
      if (/SHOW_TOAST|show_toast/.test(c.corpo)) colpevoli.push(rel);
    }
  }
  assert.deepEqual(colpevoli, [], 'un avviso di Filo va nella barra: avvisoDiFilo (src/main/services/avvisoFinestra.js)');
});

test('SHOW_TOAST esce dal main solo verso una scheda, per un avviso della pagina stessa', () => {
  const fuori = [];
  for (const { rel, testo } of FILE_MAIN) {
    const dentro = chiamate(testo, 'spingiAllaScheda');
    for (let i = testo.indexOf('MSG.SHOW_TOAST'); i >= 0; i = testo.indexOf('MSG.SHOW_TOAST', i + 1)) {
      if (!dentro.some((c) => c.da < i && i < c.a)) fuori.push(`${rel}:${testo.slice(0, i).split('\n').length}`);
    }
  }
  assert.deepEqual(fuori, []);
});

test('gli avvisi che non riguardano la pagina passano dalla barra', () => {
  const leggi = (rel) => FILE_MAIN.find((f) => f.rel === rel).testo;
  assert.match(leggi(join('src', 'main', 'services', 'handlers', 'misc.js')), /avvisoDiFilo\(`Feedback inviato, ma non sono riuscito a caricare \$\{quanti\}`/);
  const wallet = leggi(join('src', 'main', 'services', 'handlers', 'wallet.js'));
  assert.match(wallet, /avvisoDiFilo\(W\.ownKeyFallbackLine\(status\)/);
  assert.match(wallet, /avvisoDiFilo\(text\.charAt\(0\)/);
  assert.match(leggi(join('src', 'main', 'services', 'handlers.js')), /avvisoDiFilo\(I18n\.t\('toast_open_weights_violated', servedBy\)/);
});
