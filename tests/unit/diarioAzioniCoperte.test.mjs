// Sentinella: il diario del lavoro ha una frase per OGNI azione di Filo.
//
// Le parole del diario stanno in tre tabelle della home (la riga, il verbo del
// riassunto, l'etichetta del guasto) più l'elenco delle azioni che si
// raccontano col solo bottone. Un'azione nuova nel registro dei livelli che non
// entra in nessuna delle due strade cade nel ripiego: l'utente ha cancellato la
// memoria di Filo e nel diario ha trovato «Conferma chiesta» e un titolo fermo
// su «Come ha lavorato» (#567). Il buco non si vede leggendo il codice, perché
// nessuno dei due file nomina l'altro: lo vede questa sentinella.
//
// Diventa rossa se un'azione del registro non ha né riga né bottone dichiarato,
// se una riga non ha il verbo che la fa contare nel riassunto o l'etichetta per
// quando non riesce, o se una tabella nomina un'azione che non esiste più.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATTIVITA = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard-attivita.js'), 'utf8');

function registro() {
  globalThis.self = globalThis;
  globalThis.global = globalThis;
  const src = readFileSync(join(ROOT, 'src', 'shared', 'actionLevels.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('globalThis', `${src}\n`)(globalThis);
  return Object.keys(globalThis.SN_ACTION_LEVELS.REGISTRY);
}

// Le tabelle si leggono dal testo: caricare la pagina vorrebbe dire un DOM
// intero per tre elenchi di nomi.
function chiavi(nome) {
  const dopo = ATTIVITA.split(`const ${nome}`)[1];
  assert.ok(dopo, `${nome} non si trova più in dashboard-attivita.js`);
  const blocco = dopo.split('\n  };')[0];
  return [...blocco.matchAll(/(^|[\s{])([A-Z][A-Z_]+):/gm)].map((m) => m[2]);
}

function soloBottone() {
  const dopo = ATTIVITA.split('const SOLO_BOTTONE = ')[1];
  assert.ok(dopo, 'SOLO_BOTTONE non si trova più in dashboard-attivita.js');
  return JSON.parse(dopo.split(';')[0].replace(/'/g, '"'));
}

test('ogni azione di Filo ha una riga nel diario o è dichiarata «solo bottone»', () => {
  const scoperte = registro().filter((t) => !chiavi('ACTIVITY_ROWS').includes(t) && !soloBottone().includes(t));
  assert.deepEqual(scoperte, [], 'azioni senza frase nel diario: aggiungile ad ACTIVITY_ROWS o a SOLO_BOTTONE');
});

test('ogni riga del diario si conta nel riassunto e sa dire che non è riuscita', () => {
  const righe = chiavi('ACTIVITY_ROWS');
  const verbi = chiavi('ACTIVITY_VERBS');
  const guasti = chiavi('FAILED_LABELS');
  assert.deepEqual(righe.filter((t) => !verbi.includes(t)), [], 'righe senza verbo in ACTIVITY_VERBS');
  assert.deepEqual(righe.filter((t) => !guasti.includes(t)), [], 'righe senza etichetta in FAILED_LABELS');
});

test('le tabelle del diario non nominano azioni che non esistono più', () => {
  const noti = new Set(registro());
  const tutte = [...chiavi('ACTIVITY_ROWS'), ...chiavi('ACTIVITY_VERBS'), ...chiavi('FAILED_LABELS'), ...soloBottone()];
  assert.deepEqual([...new Set(tutte.filter((t) => !noti.has(t)))], []);
});

test('il ripiego del diario non mostra mai il nome interno di un\'azione', () => {
  assert.ok(
    !/text:\s*type\.toLowerCase\(\)/.test(ATTIVITA),
    'il ripiego stampa il nome interno dell\'azione: all\'utente non dice niente',
  );
});
