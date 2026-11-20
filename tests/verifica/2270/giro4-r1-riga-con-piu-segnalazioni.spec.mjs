// #2270 giro 4: la riga di novità di un pacchetto, `{ testo, segnalazione: [a, b] }`, deve passare dalla regola che
// sposta le righe del ramo nel registro di main (fusione al cancello, rebase, unit sulla fusione) come quella a un numero.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

createRequire(import.meta.url)(join(process.cwd(), 'src', 'shared', 'novitaFusione.js'));
const NF = globalThis.SN_NOVITA_FUSIONE;

const blocco = (version, features) => [
  '    {',
  `      version: '${version}', date: '2026-11-01',`,
  '      features: [',
  ...features.map((r) => `        ${r},`),
  '      ],',
  '    },',
].join('\n');
const registro = (...blocchi) => `// Novità\n(function (global) {\n  'use strict';\n\n  const NOTES = [\n${blocchi.join('\n')}\n  ];\n\n  global.SN_PATCH_NOTES = { NOTES };\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;

test('r1 i due lati scrivono in fondo allo stesso elenco: la riga del pacchetto con più numeri si unisce come quella a uno', () => {
  const base = registro(blocco('0.2.11', ["'a'"]));
  const main = registro(blocco('0.2.11', ["'a'", "'di main'"]));
  const uno = registro(blocco('0.2.11', ["'a'", "{ testo: 'del ramo', segnalazione: 812 }"]));
  expect(NF.uniscaNovita({ base, main, ramo: uno, manifesto: { version: '0.2.10' }, oggi: '2026-11-20' }).ok).toBe(true);
  const pacchetto = registro(blocco('0.2.11', ["'a'", "{ testo: 'del pacchetto', segnalazione: [812, 815] }"]));
  const r = NF.uniscaNovita({ base, main, ramo: pacchetto, manifesto: { version: '0.2.10' }, oggi: '2026-11-20' });
  expect(r.motivo).toBeUndefined();
  expect(r.ok).toBe(true);
});

test('r1 main ha pubblicato la versione su cui il pacchetto scriveva: la sua riga passa nel blocco nuovo', () => {
  const base = registro(blocco('0.2.11', ["'a'"]));
  const main = registro(blocco('0.2.12', ["'di main'"]), blocco('0.2.11', ["'a'"]));
  const ramo = registro(blocco('0.2.11', ["'a'", "{ testo: 'del pacchetto', segnalazione: [812, 815] }"]));
  const r = NF.uniscaNovita({ base, main, ramo, manifesto: { version: '0.2.11' }, oggi: '2026-11-20' });
  expect(r.motivo).toBeUndefined();
  expect(r.ok).toBe(true);
});
