// Prova del giro 5 sul #569 — le porte che escono dal FILE.
//
// COSA GUARDA
//   La sentinella (tests/unit/finiDiRiga.test.mjs) ha due reti:
//     · la prima pretende che un file del repo che viene analizzato si legga
//       dalla porta comune, e riconosce la lettura guardando la riga: o nomina
//       il file, o passa per una variabile dichiarata NELLO STESSO file;
//     · la seconda prende le ricerche che un ritorno a capo di Windows fa
//       fallire, ma guarda solo i file il cui SORGENTE nomina uno dei file
//       sorvegliati.
//   Basta che UNA delle due prenda l'esca perché il difetto si veda in tempo.
//
//   Qui si prova quello che nessuna delle due vede, perché il pezzo che le fa
//   scattare non sta più nel file:
//     · il percorso del file sorvegliato vive in un ALTRO modulo. La prima rete
//       non vede il nome sulla riga e non trova la variabile; la seconda non
//       riconosce nemmeno il file come «uno di quelli», e non lo apre affatto.
//       La ricerca può allora essere quella originale del #569, tale e quale;
//     · la stessa cosa con la ricerca scritta come stringa su due righe: un «a
//       capo» vero nel sorgente invece di `\n`, che è il modo più naturale di
//       incollare due righe di regole;
//     · un file di prova con estensione `.js` invece di `.mjs`: il camminatore
//       della sentinella non lo raccoglie, e due file del repo sotto tests/
//       hanno già quell'estensione.
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
const CARTELLA_ESCA = join(ROOT, 'tests', 'sonda-569-giro5');
const REGOLE = join(ROOT, 'firestore.rules').replace(/\\/g, '\\\\');

// Il modulo accanto all'esca che tiene il percorso: è lui a far uscire il nome
// del file sorvegliato dal file che lo analizza.
const PERCORSI = `export const REGOLE = '${REGOLE}';\n`;

/** Mette l'esca davanti alla sentinella e riporta cosa ha detto. */
function laSentinellaVede(file) {
  rmSync(CARTELLA_ESCA, { recursive: true, force: true });
  mkdirSync(CARTELLA_ESCA, { recursive: true });
  try {
    for (const [nome, contenuto] of Object.entries(file)) {
      writeFileSync(join(CARTELLA_ESCA, nome), contenuto, 'utf8');
    }
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

const PRESA = /sonda-569-giro5[/\\]esca/;

test('#569 giro 5 (taratura): l\'esca scritta nella forma nota viene presa', () => {
  // Senza questa taratura le prove qui sotto sarebbero verdi anche con la
  // sentinella spenta, o con l'esca finita in un posto dove non guarda.
  const detto = laSentinellaVede({
    'esca.mjs': `import { readFileSync } from 'node:fs';
const RULES = readFileSync('${REGOLE}', 'utf8');
export const trovato = RULES.indexOf('allow update: if\\n        isAdmin()') !== -1;
`,
  });
  assert.match(
    detto,
    PRESA,
    'la sentinella non prende nemmeno la lettura grezza di un file che nomina: la prova non sta provando niente',
  );
});

test('#569 giro 5: col percorso in un altro modulo passa il difetto ORIGINALE, tale e quale', () => {
  const detto = laSentinellaVede({
    'percorsi.mjs': PERCORSI,
    'esca.mjs': `import { readFileSync } from 'node:fs';
import { REGOLE } from './percorsi.mjs';
const RULES = readFileSync(REGOLE, 'utf8');
export const trovato = RULES.indexOf('allow update: if\\n        isAdmin()') !== -1;
`,
  });
  assert.match(
    detto,
    PRESA,
    'il percorso del file sorvegliato messo in un modulo accanto fa sparire l\'esca da tutte e due le reti: la '
    + 'lettura grezza non nomina niente sulla riga, e il file non viene nemmeno riconosciuto come uno di quelli '
    + 'da guardare, quindi passa la ricerca originale del #569 senza una riga cambiata',
  );
});

test('#569 giro 5: la ricerca scritta su due righe non è un «a capo» in meno', () => {
  const detto = laSentinellaVede({
    'percorsi.mjs': PERCORSI,
    'esca.mjs': `import { readFileSync } from 'node:fs';
import { REGOLE } from './percorsi.mjs';
const RULES = readFileSync(REGOLE, 'utf8');
export const trovato = RULES.includes(\`allow update: if
        isAdmin()\`);
`,
  });
  assert.match(
    detto,
    PRESA,
    'due righe di regole incollate in una stringa su due righe si rompono con i fini riga di Windows esattamente '
    + 'come `\\n`, ed è il modo più naturale di scriverle: la rete sulle ricerche guarda solo la riga singola',
  );
});

test('#569 giro 5: un file di prova con l\'altra estensione non lo guarda nessuno', () => {
  const detto = laSentinellaVede({
    'esca.js': `const { readFileSync } = require('node:fs');
const RULES = readFileSync('${REGOLE}', 'utf8');
module.exports = RULES.indexOf('allow update: if\\n        isAdmin()') !== -1;
`,
  });
  assert.match(
    detto,
    PRESA,
    'il camminatore della sentinella raccoglie solo i `.mjs`: sotto tests/ ci sono già due file con l\'altra '
    + 'estensione, e uno scritto così porta dentro il difetto senza essere guardato da nessuno',
  );
});
