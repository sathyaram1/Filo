// Prova del giro 3 sul #569 — fin dove arriva la sentinella dei fini riga.
//
// COSA GUARDA
//   La sentinella (tests/unit/finiDiRiga.test.mjs) è la garanzia che il difetto
//   non torni da un'altra porta. Ha due reti:
//     · la prima pretende che un file del repo che viene ANALIZZATO si legga
//       dalla porta comune (tests/helpers/testo.mjs) invece che a mano;
//     · la seconda prende le ricerche con un «a capo» in mezzo, la forma che
//       si è rotta.
//   Basta che una delle due prenda l'esca perché il difetto si veda in tempo.
//
//   Qui si prova cosa succede quando l'esca scivola FUORI da tutte e due:
//   legge il file con la variante asincrona (`readFile` di node:fs/promises`,
//   che la prima rete non nomina) e poi lo analizza con una forma che la
//   seconda rete non nomina (una regex con un «a capo» dentro, un `replace`,
//   un `$` di fine riga in una regex multiriga). È la stessa identica malattia
//   del #569, scritta con altre parole.
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
const CARTELLA_ESCA = join(ROOT, 'tests', 'sonda-569-giro3');
const REGOLE = join(ROOT, 'firestore.rules').replace(/\\/g, '\\\\');

/** Mette l'esca davanti alla sentinella e riporta cosa ha detto. */
function laSentinellaVede(contenuto) {
  rmSync(CARTELLA_ESCA, { recursive: true, force: true });
  mkdirSync(CARTELLA_ESCA, { recursive: true });
  try {
    writeFileSync(join(CARTELLA_ESCA, 'esca.mjs'), contenuto, 'utf8');
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

test('#569 giro 3 (taratura): l\'esca scritta nella forma nota viene presa', () => {
  // Senza questa taratura le prove qui sotto sarebbero verdi anche con la
  // sentinella spenta o con l'esca finita nel posto sbagliato.
  const detto = laSentinellaVede(`import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const PERCORSO = join('${ROOT.replace(/\\/g, '\\\\')}', 'firestore.rules');
export const regole = readFileSync(PERCORSO, 'utf8');
`);
  assert.match(
    detto,
    /sonda-569-giro3[/\\]esca\.mjs/,
    'la sentinella non prende nemmeno l\'esca nella forma che dichiara di sorvegliare: la prova non sta provando niente',
  );
});

test('#569 giro 3: la lettura asincrona di un file del repo non passa dalla porta e nessuno se ne accorge', () => {
  const detto = laSentinellaVede(`import { readFile } from 'node:fs/promises';
export const regole = await readFile('${REGOLE}', 'utf8');
export const riga = regole.split('|SEGNO|')[0];
`);
  assert.match(
    detto,
    /sonda-569-giro3[/\\]esca\.mjs/,
    'la regola dice «un file del repo che si analizza si legge dalla porta comune», ma la sentinella riconosce '
    + 'solo la lettura sincrona: la stessa lettura scritta con la variante asincrona passa indisturbata, e da lì '
    + 'il file torna ad arrivare coi fini riga della macchina',
  );
});

test('#569 giro 3: una ricerca con un «a capo» dentro, scritta come regex o come replace, non viene presa', () => {
  const detto = laSentinellaVede(`import { readFile } from 'node:fs/promises';
const regole = await readFile('${REGOLE}', 'utf8');
export const a = /allow update: if\\n        isAdmin\\(\\)/.test(regole);
export const b = regole.replace('allow update: if\\n        isAdmin()', 'x');
export const c = regole.match(/^ *allow read: if true;$/m); // esempio del #569
`);
  assert.match(
    detto,
    /sonda-569-giro3[/\\]esca\.mjs/,
    'queste tre ricerche si rompono tutte su un file arrivato coi fini riga di Windows, ed è esattamente il #569: '
    + 'la sentinella guarda solo le stringhe passate a indexOf/includes/split e simili, quindi una regex con un '
    + '«a capo», un replace e un `$` di fine riga le passano sotto',
  );
});
