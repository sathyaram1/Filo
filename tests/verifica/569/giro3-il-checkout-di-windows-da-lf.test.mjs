// Prova del giro 3 sul #569 — il checkout di Windows consegna LF.
//
// COSA GUARDA, E PERCHE' DA QUESTA PARTE
//   I giri 1 e 2 hanno provato la metà "lettore": un file che arriva coi fini
//   riga di Windows viene comunque analizzato bene, perché le sentinelle lo
//   normalizzano. Questa prova guarda l'ALTRA metà, quella che toglie il
//   problema alla radice: il file coi fini riga di Windows non deve arrivare
//   affatto, nemmeno su una macchina che li vuole.
//
//   Il #569 è nato lì: la macchina che pubblica scarica il repo con la
//   conversione dei fini riga accesa (è il comportamento di serie di Git for
//   Windows), e da quel momento tutto quello che un test legge ha un carattere
//   invisibile in più a ogni riga. Nessun'altra macchina lo vede.
//
//   Qui non si clona niente e non si tocca la copia di lavoro: si chiede a git
//   di scrivere i file dell'indice COME LI SCRIVEREBBE quella macchina
//   (`checkout-index` con la conversione accesa) e si guarda cosa esce.
//
// LA PROVA E' TARATA
//   Il primo test costruisce un repo usa-e-getta e fa vedere che la misura sa
//   diventare rossa: senza la dichiarazione dei fini riga quella stessa
//   conversione produce CRLF. Senza questa taratura il secondo test sarebbe
//   verde anche con lo strumento rotto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');

function git(cwd, argomenti) {
  return execFileSync('git', argomenti, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

/** I file scritti sotto `cartella`, percorsi relativi. */
function tuttiIFile(cartella, base = cartella, dentro = []) {
  for (const voce of readdirSync(cartella, { withFileTypes: true })) {
    if (voce.name === '.git') continue;
    const p = join(cartella, voce.name);
    if (voce.isDirectory()) tuttiIFile(p, base, dentro);
    else if (voce.isFile()) dentro.push(relative(base, p).replace(/\\/g, '/'));
  }
  return dentro;
}

test('#569 giro 3 (taratura): senza la dichiarazione, la conversione di Windows produce davvero CRLF', () => {
  const base = cartellaTemporanea('filo-569-taratura-');
  try {
    git(base, ['init', '-q', '.']);
    writeFileSync(join(base, 'regole.txt'), 'prima riga\nseconda riga\n', 'utf8');
    git(base, ['add', '-A']);
    git(base, ['-c', 'user.email=prova@filo', '-c', 'user.name=prova', 'commit', '-qm', 'x']);

    const senza = join(base, 'senza');
    mkdirSync(senza, { recursive: true });
    git(base, ['-c', 'core.autocrlf=true', 'checkout-index', '-a', '-f', '--prefix', `${senza}/`]);
    assert.ok(
      readFileSync(join(senza, 'regole.txt'), 'utf8').includes('\r'),
      'lo strumento non misura niente: senza la dichiarazione dei fini riga la conversione di Windows dovrebbe produrre CRLF',
    );

    // Adesso la dichiarazione vera del repo, copiata dentro il repo finto.
    copyFileSync(join(ROOT, '.gitattributes'), join(base, '.gitattributes'));
    git(base, ['add', '-A']);
    git(base, ['-c', 'user.email=prova@filo', '-c', 'user.name=prova', 'commit', '-qm', 'attributi']);

    const con = join(base, 'con');
    mkdirSync(con, { recursive: true });
    git(base, ['-c', 'core.autocrlf=true', 'checkout-index', '-a', '-f', '--prefix', `${con}/`]);
    assert.ok(
      !readFileSync(join(con, 'regole.txt'), 'utf8').includes('\r'),
      'con la dichiarazione del repo la conversione di Windows non deve più produrre CRLF',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('#569 giro 3: nessun file di testo del repo arriva coi fini riga di Windows, nemmeno su una macchina che li vuole', () => {
  const base = cartellaTemporanea('filo-569-come-windows-');
  const uscita = join(base, 'copia');
  mkdirSync(uscita, { recursive: true });
  try {
    // Gli stessi file, scritti come li scriverebbe la macchina che pubblica.
    git(ROOT, ['-c', 'core.autocrlf=true', 'checkout-index', '-a', '-f', '--prefix', `${uscita}/`]);

    // I file che git tiene per BINARI restano intatti per definizione (un'icona
    // non ha fini riga da convertire): si guardano quelli di testo.
    const binari = new Set(
      git(ROOT, ['ls-files', '--eol'])
        .split('\n')
        .filter((r) => r.startsWith('i/-text') || r.startsWith('i/none'))
        .map((r) => r.slice(r.indexOf('\t') + 1)),
    );

    const scritti = tuttiIFile(uscita);
    assert.ok(scritti.length > 500, `mi aspettavo i file del repo, ne ho trovati ${scritti.length}`);

    const coiFiniRigaDiWindows = [];
    for (const rel of scritti) {
      if (binari.has(rel)) continue;
      if (readFileSync(join(uscita, rel), 'utf8').includes('\r')) coiFiniRigaDiWindows.push(rel);
    }

    assert.deepEqual(
      coiFiniRigaDiWindows,
      [],
      'questi file arrivano coi fini riga di Windows sulla macchina che pubblica: una sentinella che li analizza '
      + 'riga per riga misurerà il sistema operativo invece del contenuto, ed è il #569',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('#569 giro 3: le regole e l\'indice dei pattern — i due file che hanno fermato la pubblicazione — arrivano puliti', () => {
  // I tre file da cui il difetto è uscito le due volte. Vale già il test qui
  // sopra, che li comprende: questo li nomina perché un rosso dica subito
  // QUALE, invece di un elenco lungo.
  for (const nome of ['firestore.rules', 'storage.rules', 'PATTERNS.md']) {
    const testo = git(ROOT, ['-c', 'core.autocrlf=true', 'cat-file', '--filters', `HEAD:${nome}`]);
    assert.ok(!testo.includes('\r'), `${nome} arriva coi fini riga di Windows sulla macchina che pubblica`);
  }
});
