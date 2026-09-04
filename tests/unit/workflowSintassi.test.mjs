// I workflow devono poter PARTIRE.
//
// Un errore in un file di `.github/workflows/` non si comporta come un errore
// nel codice: non fa fallire un test, non stampa niente dove qualcuno guarda.
// La corsa nasce e muore nello stesso secondo, senza un solo job, e chi legge
// il verdetto trova "nessun verdetto per questo commit" — che è
// indistinguibile da "la suite non è ancora arrivata". È successo davvero:
// aggiungendo `branches-ignore` accanto a `branches` (corse 107 e 108 del
// 2026-09-04) la suite completa è rimasta spenta per due commit senza che
// nessuno se ne accorgesse.
//
// GitHub rifiuta l'intero file quando due filtri che si escludono compaiono
// nello stesso evento: `branches`/`branches-ignore`, `tags`/`tags-ignore`,
// `paths`/`paths-ignore`. L'esclusione si scrive DENTRO la lista positiva, come
// motivo negativo (`- '!prova-fusione/**'`).
//
// Questa sentinella gira in millisecondi sulla macchina di chi ha scritto la
// modifica, che è l'unico posto in cui la notizia serve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARTELLA = resolve(__dirname, '..', '..', '.github', 'workflows');

// Le coppie che GitHub rifiuta, nello stesso evento.
const ESCLUSIVE = [
  ['branches', 'branches-ignore'],
  ['tags', 'tags-ignore'],
  ['paths', 'paths-ignore'],
];

/**
 * Le chiavi dei filtri, evento per evento, sotto `on:`. PURA: prende il testo
 * del workflow e torna { <evento>: [<chiavi>] }.
 *
 * Non è un parser YAML — non serve: i filtri stanno sempre a due livelli sotto
 * `on:` e si riconoscono dal rientro. Un parser vero pretenderebbe una
 * dipendenza che questo repo non dichiara, e la sentinella smetterebbe di
 * girare il giorno in cui quella dipendenza sparisce da sola.
 */
export function filtriPerEvento(testo) {
  const righe = String(testo).split('\n');
  const out = {};
  let dentroOn = false;
  let rientroEvento = null;
  let evento = null;

  for (const riga of righe) {
    if (!riga.trim() || riga.trim().startsWith('#')) continue;
    const rientro = riga.length - riga.trimStart().length;
    const contenuto = riga.trim();

    if (rientro === 0) {
      dentroOn = /^(on|'on'|"on"|true):/.test(contenuto);
      rientroEvento = null;
      evento = null;
      continue;
    }
    if (!dentroOn) continue;

    if (rientroEvento === null || rientro === rientroEvento) {
      // Il nome dell'evento (push, pull_request, schedule…).
      const m = contenuto.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
      if (m) {
        rientroEvento = rientro;
        evento = m[1];
        out[evento] = out[evento] || [];
      }
      continue;
    }
    if (rientro > rientroEvento && evento) {
      const m = contenuto.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
      if (m) out[evento].push(m[1]);
    }
  }
  return out;
}

function workflows() {
  return readdirSync(CARTELLA)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ nome: f, testo: readFileSync(join(CARTELLA, f), 'utf8') }));
}

test('nessun workflow mette insieme due filtri che si escludono (GitHub rifiuta il file intero)', () => {
  const files = workflows();
  assert.ok(files.length > 0, 'nessun workflow trovato: la sentinella starebbe guardando il vuoto');

  const guasti = [];
  for (const { nome, testo } of files) {
    const eventi = filtriPerEvento(testo);
    for (const [evento, chiavi] of Object.entries(eventi)) {
      for (const [a, b] of ESCLUSIVE) {
        if (chiavi.includes(a) && chiavi.includes(b)) {
          guasti.push(`${nome}: on.${evento} ha sia "${a}" sia "${b}"`);
        }
      }
    }
  }

  assert.deepEqual(
    guasti, [],
    `workflow che non partirebbero affatto (non "rossi": MAI ESEGUITI):\n  ${guasti.join('\n  ')}\n`
    + 'L\'esclusione va scritta dentro la lista positiva, come motivo negativo: - \'!prova-fusione/**\'',
  );
});

test('la suite completa gira su tutti i rami di lavoro, tranne quelli usa-e-getta della prova di fusione', () => {
  const testo = readFileSync(join(CARTELLA, 'suite.yml'), 'utf8');
  const eventi = filtriPerEvento(testo);

  assert.ok(eventi.push, 'la suite completa non parte più a ogni push: non varrebbe più niente');
  assert.ok(
    eventi.push.includes('branches'),
    'senza `branches` la suite girerebbe anche sui tag, cioè a ogni release',
  );
  assert.ok(
    /-\s*'\*\*'/.test(testo),
    'la suite deve girare su TUTTI i rami di lavoro: senza `**` copre solo quelli elencati',
  );
  assert.ok(
    /-\s*'!prova-fusione\/\*\*'/.test(testo),
    'i rami usa-e-getta della prova di fusione non devono accendere una suite intera',
  );
});

// La forma sbagliata deve essere riconosciuta: senza questo, il primo test
// potrebbe passare perché non guarda niente.
test('la sentinella riconosce la forma che ha spento la suite', () => {
  const rotto = [
    'name: prova',
    'on:',
    '  push:',
    "    branches: ['**']",
    "    branches-ignore: ['prova-fusione/**']",
    '  workflow_dispatch: {}',
  ].join('\n');
  assert.deepEqual(filtriPerEvento(rotto).push, ['branches', 'branches-ignore']);

  const sano = [
    'name: prova',
    'on:',
    '  push:',
    '    branches:',
    "      - '**'",
    "      - '!prova-fusione/**'",
    '  workflow_dispatch: {}',
  ].join('\n');
  assert.deepEqual(filtriPerEvento(sano).push, ['branches']);
});
