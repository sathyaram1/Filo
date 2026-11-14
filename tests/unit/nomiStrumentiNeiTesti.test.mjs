// I testi che il modello della chat legge citano le azioni come strumento(azione) (SPEC-CONTESTO § Gli strumenti): ogni
// citazione deve esistere, e nessun testo deve nominare un tipo che lo strumento non porta più (#1564, giro 2).
// Fuori regola solo i prompt degli altri agenti che parlano JSON coi tipi ("type", "action"): lì il tipo è il formato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(radice, 'src/shared/actionTools.js'));
const T = globalThis.SN_ACTION_TOOLS;

function sorgenti() {
  const out = [];
  const giu = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) giu(p);
      else if (p.endsWith('.js') && !p.endsWith(`${path.sep}actionTools.js`)) out.push(p);
    }
  };
  for (const d of ['src/shared', 'src/main', 'src/pages']) giu(path.join(radice, d));
  return out;
}

// Le stringhe e i pezzi fissi dei template di un file, con la riga.
function testi(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const visita = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ t: n.text, n });
    else if (ts.isTemplateExpression(n)) out.push({ t: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' '), n });
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return out.map(({ t, n }) => ({ t, dove: `${path.relative(radice, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}` }));
}

const tutti = sorgenti().flatMap(testi);

test('ogni strumento(azione) citato in un testo esiste', () => {
  const mancano = [];
  for (const { t, dove } of tutti) {
    for (const m of t.matchAll(/\b([a-z_]+)\(([a-z_]*)\)/g)) {
      if (T.NOMI_STRUMENTI.includes(m[1]) && !T.AZIONI[m[1]][m[2]]) mancano.push(`${dove} ${m[0]}`);
    }
  }
  assert.deepEqual(mancano, []);
});

test('nessuna frase nomina un tipo vecchio al posto di strumento(azione)', () => {
  const nome = new RegExp(`\\b(${T.NAMES.join('|')})\\b`);
  const vecchi = tutti
    .filter(({ t }) => /\s/.test(t.trim()) && nome.test(t) && !/"type"|"action"|\baction\b/.test(t))
    .map(({ t, dove }) => `${dove} ${t.match(nome)[0]}`);
  assert.deepEqual(vecchi, []);
});

test('la sentinella vede i testi che deve vedere', () => {
  assert.ok(tutti.some(({ t }) => t.includes('filo(rimetti_chat)')), 'la ricerca delle conversazioni nascoste');
  assert.ok(tutti.some(({ t }) => t.includes('filo_su_di_se(documento)')), 'l\'intervista di benvenuto');
});
