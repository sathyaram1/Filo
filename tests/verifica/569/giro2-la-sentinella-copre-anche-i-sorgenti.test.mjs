// Prova del giro 2 sul #569 — quanto arriva lontano la sentinella dei fini
// riga.
//
// COSA GUARDA
//   La sentinella (tests/unit/finiDiRiga.test.mjs) esiste per impedire che il
//   difetto torni da un'altra porta: un test che legge un file del REPO per
//   conto suo e lo analizza riga per riga diventa rosso su un computer solo —
//   quello che pubblica — e blocca la pubblicazione per giorni.
//
//   Qui si prova la sentinella con delle esche: si scrive un finto test che
//   commette il difetto e si guarda se la sentinella lo prende. Tre esche:
//   · in una sottocartella qualunque di tests/ (porta trovata al giro 1);
//   · col percorso del file messo in una variabile la riga prima (giro 1);
//   · su un SORGENTE dell'app e su un LAVORO automatico — due file che altre
//     sentinelle leggono e analizzano già oggi.
//
// PERCHE' L'ESCA E' UN FILE VERO
//   La sentinella cammina la cartella tests/ del repo: per sapere se prende
//   qualcosa bisogna metterglielo davanti dove guarda. L'esca nasce e muore
//   dentro la prova.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');
const CARTELLA_ESCA = join(ROOT, 'tests', 'sonda-569-giro2');

/** Mette l'esca davanti alla sentinella e riporta cosa ha detto. */
function laSentinellaVede(nomeFile, contenuto) {
  rmSync(CARTELLA_ESCA, { recursive: true, force: true });
  mkdirSync(CARTELLA_ESCA, { recursive: true });
  try {
    writeFileSync(join(CARTELLA_ESCA, nomeFile), contenuto, 'utf8');
    // L'ambiente di questo processo porta i segni di `node --test`: passati al
    // processo figlio lo farebbero uscire subito e verde.
    const ambiente = { ...process.env };
    delete ambiente.NODE_TEST_CONTEXT;
    delete ambiente.NODE_OPTIONS;
    const esito = spawnSync(
      process.execPath,
      ['--test', join('tests', 'unit', 'finiDiRiga.test.mjs')],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16, env: ambiente },
    );
    return `${esito.stdout || ''}${esito.stderr || ''}`;
  } finally {
    rmSync(CARTELLA_ESCA, { recursive: true, force: true });
  }
}

test('#569 giro 2 (porta del giro 1): l\'esca in una sottocartella qualunque viene presa', () => {
  const detto = laSentinellaVede('esca.mjs', `import { readFileSync } from 'node:fs';
export const regole = readFileSync('${join(ROOT, 'firestore.rules').replace(/\\/g, '\\\\')}', 'utf8');
`);
  assert.match(
    detto,
    /sonda-569-giro2\/esca\.mjs/,
    'la sentinella non guarda dentro le sottocartelle di tests/: una prova messa lì può leggere un file del repo nel modo che si rompe su Windows senza che nessuno se ne accorga',
  );
});

test('#569 giro 2 (porta del giro 1): il percorso spostato in una variabile non fa sparire l\'esca', () => {
  const detto = laSentinellaVede('esca.mjs', `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const PERCORSO = join('${ROOT.replace(/\\/g, '\\\\')}', 'firestore.rules');
export const regole = readFileSync(PERCORSO, 'utf8');
`);
  assert.match(
    detto,
    /sonda-569-giro2\/esca\.mjs/,
    'basta spostare il percorso in una variabile la riga prima e la lettura grezza torna invisibile',
  );
});

// Questo rilievo il server lo ha messo da parte: lo apre come feedback a sé, e
// in questo giro non si corregge. La prova resta qui, spenta, perché il giorno
// in cui si allarga l'elenco dei file sorvegliati è già pronta: toglierle lo
// `skip` è tutto quello che serve per sapere se la porta si è chiusa. Rossa non
// può restare: nella cartella di un giro un rosso vuol dire «porta riaperta», e
// questa non è mai stata chiusa.
test('#569 giro 2: anche un SORGENTE dell\'app e un LAVORO automatico sono file che si analizzano', { skip: 'rilievo di livello 1 messo da parte dal server: lo corregge il feedback derivato' }, () => {
  // Due file che altre sentinelle leggono e analizzano già oggi: i sorgenti
  // condivisi e la ricetta della pubblicazione. Con i fini riga di Windows una
  // ricerca come queste due non trova più niente, ed è esattamente il #569.
  const detto = laSentinellaVede('esca.mjs', `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SORGENTE = join('${ROOT.replace(/\\/g, '\\\\')}', 'src', 'shared', 'constants.js');
const codice = readFileSync(SORGENTE, 'utf8');
export const a = codice.indexOf('PROMPTS: {\\n    spellcheckWord');
const lavoro = readFileSync(join('${ROOT.replace(/\\/g, '\\\\')}', '.github', 'workflows', 'release.yml'), 'utf8');
export const b = lavoro.indexOf('runs-on: windows-latest\\n    steps:');
`);
  assert.match(
    detto,
    /sonda-569-giro2\/esca\.mjs/,
    'la sentinella sorveglia solo le regole e l\'indice dei pattern: un test che analizza un sorgente dell\'app o '
    + 'un lavoro automatico passa indisturbato, ed è la stessa porta accanto da cui il difetto è già rientrato una volta',
  );
});
