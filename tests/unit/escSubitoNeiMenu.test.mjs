// Sentinella: i tasti di un menu o di un riquadro (Esc che lo chiude) si ascoltano appena esiste, non dopo un timer.
// In un setTimeout, l'Esc premuto subito dopo l'apertura andava perso: il menu restava aperto sopra la voce (#1219).
// Il timer resta lecito per il clic fuori e lo scorrimento, che il gesto d'apertura stesso farebbe scattare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sorgenti(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { if (nome !== 'node_modules') sorgenti(p, out); }
    else if (/\.(m?js)$/.test(nome)) out.push(p);
  }
  return out;
}

// Il corpo del timer fino alla sua parentesi di chiusura (conteggio semplice: basta per il codice di Filo).
function corpoDelTimer(testo, da) {
  let livello = 0;
  for (let i = da; i < testo.length && i < da + 4000; i++) {
    const c = testo[i];
    if (c === '(') livello += 1;
    else if (c === ')') { livello -= 1; if (livello === 0) return testo.slice(da, i + 1); }
  }
  return testo.slice(da, da + 600);
}

function tastiRimandati(testo) {
  const trovati = [];
  const re = /setTimeout\s*\(/g;
  let m;
  while ((m = re.exec(testo))) {
    const corpo = corpoDelTimer(testo, m.index + m[0].length - 1);
    if (/addEventListener\(\s*['"]key(down|up)['"]/.test(corpo)) {
      trovati.push(testo.slice(0, m.index).split('\n').length);
    }
  }
  return trovati;
}

test('il riconoscitore vede un Esc rimandato e lascia passare il clic fuori rimandato', () => {
  const rimandato = "setTimeout(() => {\n  document.addEventListener('mousedown', fuori, true);\n  document.addEventListener('keydown', tasto, true);\n}, 0);";
  const giusto = "document.addEventListener('keydown', tasto, true);\nsetTimeout(() => {\n  if (box !== questo) return;\n  document.addEventListener('mousedown', fuori, true);\n}, 0);";
  assert.deepEqual(tastiRimandati(rimandato), [1]);
  assert.deepEqual(tastiRimandati(giusto), []);
});

test('nessun menu di Filo ascolta i tasti solo dopo un timer', () => {
  const colpevoli = [];
  for (const file of sorgenti(join(ROOT, 'src'))) {
    for (const riga of tastiRimandati(readFileSync(file, 'utf8'))) {
      colpevoli.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${riga}`);
    }
  }
  assert.deepEqual(colpevoli, [], `tasti registrati dentro un setTimeout (registrali subito, fuori dal timer): ${colpevoli.join(', ')}`);
});
