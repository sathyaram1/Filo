// Prova del giro 4 sul #569 — la ricerca COSTRUITA, e la lettura che passa di
// mano.
//
// COSA GUARDA
//   La sentinella (tests/unit/finiDiRiga.test.mjs) ha due reti, e il giro 3 le
//   ha allargate perché guardino la FORMA e non il nome:
//     · la prima pretende che un file del repo che viene analizzato si legga
//       dalla porta comune (tests/helpers/testo.mjs);
//     · la seconda prende le ricerche che un ritorno a capo di Windows fa
//       fallire — dentro una stringa passata a un metodo di ricerca, dentro un
//       letterale di espressione regolare, e il `$` di fine riga in modalità
//       multiriga.
//   Basta che UNA delle due prenda l'esca perché il difetto si veda in tempo.
//
//   Qui si prova la coppia che scivola fuori da tutte e due:
//     · la lettura non sta sulla riga che nomina il file (passa da una
//       funzioncina di una riga, oppure dal nome cambiato all'import): la
//       prima rete non la vede;
//     · la ricerca non è un letterale né una stringa data a un metodo: è
//       un'espressione regolare COSTRUITA. La seconda rete guarda solo i
//       letterali e i metodi, e non la vede.
//   Insieme fanno esattamente la malattia del #569 — la ricerca che su un
//   checkout con i fini riga di Windows non trova più niente — senza un rosso.
//
//   La forma costruita non è esotica: è quella con cui il lavoro di questo
//   feedback ha RIPARATO la sentinella delle regole dei livelli. È quindi la
//   forma che chiunque copierà la prossima volta, con un «a capo» al posto di
//   `\s+`.
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
const CARTELLA_ESCA = join(ROOT, 'tests', 'sonda-569-giro4');
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

const PRESA = /sonda-569-giro4[/\\]esca\.mjs/;

test('#569 giro 4 (taratura): l\'esca scritta nella forma nota viene presa', () => {
  // Senza questa taratura le prove qui sotto sarebbero verdi anche con la
  // sentinella spenta, o con l'esca finita in un posto dove non guarda.
  const detto = laSentinellaVede(`import { readFileSync } from 'node:fs';
const RULES = readFileSync('${REGOLE}', 'utf8');
export const trovato = RULES.indexOf('allow update: if\\n        isAdmin()') !== -1;
`);
  assert.match(
    detto,
    PRESA,
    'la sentinella non prende nemmeno la lettura grezza di un file che nomina: la prova non sta provando niente',
  );
});

test('#569 giro 4: lettura da una funzioncina + ricerca COSTRUITA passano senza un rosso', () => {
  const detto = laSentinellaVede(`import { readFileSync } from 'node:fs';
const leggi = (p) => readFileSync(p, 'utf8');
const RULES = leggi('${REGOLE}');
export const trovato = new RegExp('allow update: if\\\\n        isAdmin\\\\(\\\\)').test(RULES);
`);
  assert.match(
    detto,
    PRESA,
    'un file del repo letto passando per una funzioncina di una riga e analizzato con una regex COSTRUITA '
    + '(`new RegExp` invece di un letterale) scivola fuori da tutte e due le reti: è la malattia del #569 '
    + 'intera, e nessuno la vede finché non tocca al computer che pubblica',
  );
});

test('#569 giro 4: la stessa cosa col nome della lettura cambiato all\'import', () => {
  const detto = laSentinellaVede(`import { readFileSync as leggiGrezzo } from 'node:fs';
const RULES = leggiGrezzo('${REGOLE}', 'utf8');
export const trovato = new RegExp('allow update: if\\\\n        isAdmin\\\\(\\\\)').test(RULES);
`);
  assert.match(
    detto,
    PRESA,
    'basta rinominare la lettura all\'import perché la prima rete non la riconosca; se anche la ricerca è '
    + 'costruita, la seconda non la riconosce e il difetto entra indisturbato',
  );
});
