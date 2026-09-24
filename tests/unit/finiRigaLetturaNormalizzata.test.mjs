// Sentinella: un unit test non può vedere i fini riga di un file del repo.
// Misura il FATTO, in quattro modi di scrivere la stessa cosa, invece di
// riconoscere i modi. Il perché sta in patterns/un-file-del-repo-che-un-test-analizza-arriva-coi-fini-riga.md
//
// COSA SI GIOCA QUI
//   Un file del repo arriva coi fini riga di chi ha clonato. Una ricerca che
//   contiene un «a capo» allora non trova più niente e il test dice che manca
//   una cosa che nel file c'è: rosso su una macchina sola, e quella macchina è
//   il cancello della pubblicazione (#565, poi #569: quattro giorni senza
//   nessuna versione per nessuno).
//
//   Per quattro giri la difesa è stata riconoscere i MODI DI SCRIVERE la
//   lettura e la ricerca, e a ogni giro ne entrava uno nuovo: il percorso
//   spostato in un altro modulo, la stringa su due righe, la lettura affidata a
//   una funzione, l'espressione regolare costruita, l'altra estensione. La
//   difesa adesso non riconosce niente: il lanciatore degli unit test carica un
//   modulo che normalizza QUALUNQUE lettura di testo di un file del repo, e
//   quindi nessuna di quelle forme può più sbagliare. Qui si prova che la cosa
//   vale davvero, sul lanciatore vero, e che senza di lui quelle stesse forme
//   sarebbero rosse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
// Dentro il repo (è lì che la regola vale) e con un punto davanti, così i
// camminatori delle altre sentinelle non ci entrano.
const SONDA = join(ROOT, 'tests', '.sonda-fini-riga');

// Il file «del repo» dell'esca, scritto coi fini riga di Windows: è la copia
// storta che una macchina può avere sul disco.
const REGOLE = 'allow update: if\r\n        isAdmin();\r\n';

// Le quattro forme sono quelle che i giri di verifica hanno portato una per
// volta: nessuna nomina il file e la lettura nello stesso modo dell'altra.
const ESCHE = {
  'percorsi.mjs': "export const REGOLE = new URL('./regole.txt', import.meta.url);\n",
  'leggi.js': "const { readFileSync } = require('node:fs');\nmodule.exports = (p) => readFileSync(p, 'utf8');\n",

  'a-lettura-diretta.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('forma a: lettura diretta e stringa con un a capo', () => {
  const regole = readFileSync(new URL('./regole.txt', import.meta.url), 'utf8');
  assert.ok(regole.indexOf('allow update: if\\n        isAdmin();') !== -1);
});
`,

  'b-percorso-altrove.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGOLE } from './percorsi.mjs';
test('forma b: il percorso vive in un altro modulo', () => {
  const regole = readFileSync(REGOLE, 'utf8');
  assert.ok(regole.indexOf('allow update: if\\n        isAdmin();') !== -1);
});
`,

  'c-funzione-e-regex-costruita.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const leggi = createRequire(import.meta.url)('./leggi.js');
test('forma c: lettura affidata a una funzione, ricerca costruita', () => {
  const regole = leggi(new URL('./regole.txt', import.meta.url));
  assert.ok(new RegExp('allow update: if\\\\n        isAdmin\\\\(\\\\);').test(regole));
});
`,

  'd-asincrona-e-stringa-su-due-righe.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile as leggiGrezzo } from 'node:fs/promises';
test('forma d: lettura asincrona rinominata, stringa scritta su due righe', async () => {
  const regole = await leggiGrezzo(new URL('./regole.txt', import.meta.url), 'utf8');
  assert.ok(regole.includes(\`allow update: if
        isAdmin();\`));
});
`,
};

/** Scrive la sonda e restituisce i percorsi delle quattro esche. */
function preparaSonda() {
  rmSync(SONDA, { recursive: true, force: true });
  mkdirSync(SONDA, { recursive: true });
  writeFileSync(join(SONDA, 'regole.txt'), REGOLE, 'utf8');
  for (const [nome, contenuto] of Object.entries(ESCHE)) writeFileSync(join(SONDA, nome), contenuto, 'utf8');
  return Object.keys(ESCHE)
    .filter((n) => n.endsWith('.test.mjs'))
    .map((n) => join(SONDA, n));
}

// L'ambiente di questo processo porta i segni di `node --test`: passati al
// figlio lo farebbero uscire subito e verde.
function ambientePulito(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

test('il lanciatore fa arrivare un file del repo coi fini riga del repo, in ogni forma', () => {
  preparaSonda();
  try {
    const esito = spawnSync(
      process.execPath,
      [join('scripts', 'run-unit-tests.mjs')],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16, env: ambientePulito({ FILO_UNIT_DIR: SONDA }) },
    );
    const detto = `${esito.stdout || ''}${esito.stderr || ''}`;
    assert.match(detto, /# pass 4\b/, `le quattro esche dovevano girare tutte:\n${detto.slice(-2000)}`);
    assert.match(
      detto,
      /# fail 0\b/,
      'un unit test ha visto i fini riga del disco invece di quelli del repo: su una copia scaricata da Windows '
      + `diventa rosso lì e solo lì, ed è il difetto che ha fermato la pubblicazione due volte\n${detto.slice(-3000)}`,
    );
  } finally {
    rmSync(SONDA, { recursive: true, force: true });
  }
});

test('taratura: senza il lanciatore quelle stesse quattro forme sono rosse', () => {
  // Senza questa prova la sentenza qui sopra sarebbe verde anche a difesa
  // spenta: è lei a dire che le quattro esche sono davvero fragili.
  const esche = preparaSonda();
  try {
    const esito = spawnSync(
      process.execPath,
      ['--test', ...esche],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16, env: ambientePulito() },
    );
    const detto = `${esito.stdout || ''}${esito.stderr || ''}`;
    assert.match(
      detto,
      /# fail 4\b/,
      `le esche dovevano essere tutte e quattro rosse senza la normalizzazione:\n${detto.slice(-2000)}`,
    );
  } finally {
    rmSync(SONDA, { recursive: true, force: true });
  }
});
