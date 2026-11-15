// Le righe di novità di un ramo unite al registro di main senza eseguirlo (#2543): la regola che prova al cancello e
// server applicano uguale. Righe dei due lati tutte, nessun doppione, e solo dati: il resto si unisce a mano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggiunteSottoUscite, registroDa, spostaInCima } from '../../scripts/lib/novita-in-cima.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
createRequire(import.meta.url)(join(ROOT, 'src', 'shared', 'novitaFusione.js'));
const { uniscaNovita, rigaDiDati } = globalThis.SN_NOVITA_FUSIONE;

const blocco = (version, { features = [], fixes = [] } = {}) => [
  '    {',
  `      version: '${version}', date: '2026-11-01',`,
  '      features: [',
  ...features.map((r) => `        ${r},`),
  '      ],',
  '      fixes: [',
  ...fixes.map((r) => `        ${r},`),
  '      ],',
  '    },',
].join('\n');
const registro = (...blocchi) => `// Novità\n(function (global) {\n  'use strict';\n\n  const NOTES = [\n${blocchi.join('\n')}\n  ];\n\n  global.SN_PATCH_NOTES = { NOTES };\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
const dati = (src) => JSON.parse(JSON.stringify(registroDa(src)));
const OGGI = '2026-11-15';

test('main ha pubblicato la versione su cui il ramo scriveva: le righe del ramo vanno nel blocco nuovo di main, e la sentinella è verde', () => {
  const base = registro(blocco('0.2.11', { features: ["'a'"] }), blocco('0.2.10', { features: ["'vecchia'"] }));
  const ramo = registro(blocco('0.2.11', { features: ["'a'", "'del ramo'"], fixes: ["{ testo: 'corretta dal ramo', segnalazione: 2214 }"] }), blocco('0.2.10', { features: ["'vecchia'"] }));
  const main = registro(blocco('0.2.12', { features: ["'di main'"] }), blocco('0.2.11', { features: ["'a'", "'uscita con main'"] }), blocco('0.2.10', { features: ["'vecchia'"] }));
  const r = uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.11' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.verso, '0.2.12');
  assert.deepEqual(dati(r.src), [
    { version: '0.2.12', date: '2026-11-01', features: ['di main', 'del ramo'], fixes: [{ testo: 'corretta dal ramo', segnalazione: 2214 }] },
    { version: '0.2.11', date: '2026-11-01', features: ['a', 'uscita con main'], fixes: [] },
    { version: '0.2.10', date: '2026-11-01', features: ['vecchia'], fixes: [] },
  ]);
  assert.deepEqual(aggiunteSottoUscite(dati(main), dati(r.src), '0.2.11'), []);
});

test('i due lati scrivono in fondo allo stesso elenco (il conflitto di testo): restano tutte le righe, una volta sola', () => {
  const base = registro(blocco('0.2.11', { features: ["'a'"] }));
  const main = registro(blocco('0.2.11', { features: ["'a'", "'di main'", "'uguale'"] }));
  const ramo = registro(blocco('0.2.11', { features: ["'a'", "'del ramo'", "'uguale'", "'del ramo'"] }));
  const r = uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.10' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(dati(r.src)[0].features, ['a', 'di main', 'uguale', 'del ramo']);
  assert.deepEqual(r.aggiunte, [{ chiave: 'features', riga: "'del ramo'" }]);
});

test('sopra la versione uscita main non ha un blocco: se ne apre uno con la data data, in cima', () => {
  const base = registro(blocco('0.2.11', { fixes: ["'a'"] }));
  const main = registro(blocco('0.2.11', { fixes: ["'a'"] }));
  const ramo = registro(blocco('0.2.11', { fixes: ["'a'", '"del ramo"'] }));
  const r = uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.11' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(dati(r.src).map((n) => [n.version, n.date, n.fixes]), [['0.2.12', OGGI, ['del ramo']], ['0.2.11', '2026-11-01', ['a']]]);
});

test('anche un blocco aperto dal ramo porta le sue righe nel blocco in cima di main', () => {
  const base = registro(blocco('0.2.10', { features: ["'a'"] }));
  const ramo = registro(blocco('0.2.11', { features: ["'del ramo'"] }), blocco('0.2.10', { features: ["'a'"] }));
  const main = registro(blocco('0.2.12', { fixes: ["'di main'"] }), blocco('0.2.11', { features: ["'uscita'"] }), blocco('0.2.10', { features: ["'a'"] }));
  const r = uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.11' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(dati(r.src).map((n) => [n.version, n.features, n.fixes]), [
    ['0.2.12', ['del ramo'], ['di main']], ['0.2.11', ['uscita'], []], ['0.2.10', ['a'], []],
  ]);
});

test('senza righe nuove del ramo il registro è quello di main, intero', () => {
  const base = registro(blocco('0.2.11', { features: ["'a'"] }));
  const main = registro(blocco('0.2.11', { features: ["'a'", "'di main'"] }));
  const r = uniscaNovita({ base, main, ramo: base, manifesto: { version: '0.2.10' }, oggi: OGGI });
  assert.deepEqual([r.ok, r.src, r.aggiunte], [true, main, []]);
});

test('un ramo che toglie, riscrive o cambia altro nel registro non si unisce a macchina', () => {
  const base = registro(blocco('0.2.11', { features: ["'a'"] }));
  const main = registro(blocco('0.2.11', { features: ["'a'", "'m'"] }));
  const prova = (ramo) => uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.10' }, oggi: OGGI });
  assert.match(prova(registro(blocco('0.2.11', { features: ["'A'", "'nuova'"] }))).motivo, /tolto o riscritto/);
  assert.match(prova(registro(blocco('0.2.11', { features: ["'a'", "'nuova'"] })).replace('// Novità', '// Altro')).motivo, /anche fuori dalle righe aggiunte/);
  assert.match(prova(registro(blocco('0.2.11', { features: ["'a'", "require('child_process').exec('x')"] }))).motivo, /non è un semplice testo/);
  assert.match(prova('non è un registro').motivo, /non leggo il registro del ramo/);
  assert.match(uniscaNovita({ base, main, ramo: base, manifesto: { version: '0.2.10' }, oggi: 'ieri' }).motivo, /data/);
});

test('una riga che si sposta è solo un dato: stringa su una riga, o { testo, segnalazione }', () => {
  for (const ok of ["'x'", '"x \\" y"', "'l\\'altra'", "{ testo: 'x', segnalazione: 12 }", "{ testo: \"x\" }"]) assert.equal(rigaDiDati(ok), true, ok);
  for (const no of ['`x${a}`', "'a' + b", "{ testo: 'x', segnalazione: f() }", "{ testo: 'x', altro: 1 }", "x()", "'a'\n'b'"]) assert.equal(rigaDiDati(no), false, no);
});

test('sul registro vero: una riga del ramo sotto il secondo blocco va in cima, e il resto resta byte per byte', () => {
  const vero = readFileSync(join(ROOT, 'src', 'shared', 'patchNotes.js'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const prima = dati(vero);
  const seconda = prima[1].version;
  const riga = "{ testo: 'Una riga del ramo finita sotto una versione uscita.', segnalazione: 2543 }";
  const ramo = vero.replace(`version: '${seconda}'`, `version: '${seconda}'`).replace(/(version: '[^']+', date: '[^']+',\n\s*features: \[\n)/g, (m, g, off) => (vero.indexOf(`version: '${seconda}'`) < off && vero.indexOf(`version: '${seconda}'`) > off - 200 ? `${g}        ${riga},\n` : m));
  assert.notEqual(ramo, vero, 'la riga di prova non è entrata nel secondo blocco');
  const manifesto = { ...pkg, version: seconda };
  delete manifesto.prossimaVersione;
  const r = uniscaNovita({ base: vero, main: vero, ramo, manifesto, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  const dopo = dati(r.src);
  assert.equal(dopo.length, prima.length);
  assert.deepEqual(dopo[0].features.at(-1), { testo: 'Una riga del ramo finita sotto una versione uscita.', segnalazione: 2543 });
  assert.deepEqual(dopo.slice(1), prima.slice(1));
  // Lo stesso esito dello spostamento del riallineamento: la stessa riga, nello stesso blocco.
  const s = spostaInCima(ramo, { prima, manifesto, oggi: OGGI });
  assert.equal(s.ok, true, s.motivo);
  assert.deepEqual(dati(s.src), dopo);
});
