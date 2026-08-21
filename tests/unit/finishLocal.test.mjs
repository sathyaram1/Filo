// Chiusura di un lavoro locale — SPEC-RIDISEGNO-MAX.md §10
//
// Logica pura di `scripts/finish-local.mjs`. Tre cose:
//
//   · quali spec mirati lanciare per le aree toccate;
//   · la SENTINELLA sul fatto che questa macchina non scrive più sul ramo
//     principale. Da quando la fusione la fa il server, una riga che rimettesse
//     qui un `push origin main` (o un passaggio sul ramo principale per fondere
//     in locale) riaprirebbe esattamente il buco che la spec chiude — e nessun
//     test di comportamento se ne accorgerebbe, perché il lavoro arriverebbe su
//     main lo stesso.
//   · la DESTINAZIONE della spedizione. Le guardie qui sopra validano il NOME
//     del ramo di partenza; la destinazione, con `git push origin <ramo>`, la
//     sceglie la configurazione locale di git — che è un file non versionato.
//     Il test comportamentale qui sotto avvelena quella configurazione in un
//     repo usa-e-getta e pretende che il ramo principale non si muova.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { specsForChangedFiles, isProtectedBranch, pushArgs } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORGENTE = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');

describe('quali spec lanciare', () => {
  test('una pagina toccata porta con sé il suo spec', () => {
    assert.deepEqual(specsForChangedFiles(['src/pages/manage/manage.js']), ['tests/manage']);
  });

  test('uno spec modificato a mano viene incluso così com’è', () => {
    assert.deepEqual(specsForChangedFiles(['tests/editor-chat.spec.mjs']), ['tests/editor-chat']);
  });

  test('niente duplicati quando più file portano allo stesso spec', () => {
    const out = specsForChangedFiles(['src/pages/manage/manage.js', 'src/pages/manage/manage.html']);
    assert.deepEqual(out, ['tests/manage']);
  });

  test('i file fuori dall’app non tirano dentro spec a caso', () => {
    assert.deepEqual(specsForChangedFiles(['README.md', 'scripts/dispatch.mjs', '.gitignore']), []);
  });

  test('lista vuota o non valida non esplode', () => {
    assert.deepEqual(specsForChangedFiles([]), []);
    assert.deepEqual(specsForChangedFiles(null), []);
  });
});

describe('da qui sul ramo principale non si scrive', () => {
  // Le righe di commento raccontano la storia (e nominano main di continuo):
  // la sentinella deve guardare il CODICE. Vanno via anche i blocchi `/* */`,
  // non solo le righe `//`: un commento che spiega il buco nomina per forza
  // main, origin e push, e non deve poter far passare (né far fallire) una
  // sentinella che parla del codice.
  const codice = SORGENTE.split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'));
    })
    .join('\n');

  test('nessuna spedizione verso il ramo principale', () => {
    assert.ok(!/push['"\s,\]]+.*MAIN/.test(codice) && !/push[^\n]*origin[^\n]*main/i.test(codice),
      'il finish locale non deve poter spingere sul ramo principale: la fusione la fa il server');
  });

  test('nessuna fusione fatta in locale', () => {
    assert.ok(!/'merge'/.test(codice) && !/"merge"/.test(codice),
      'nessun git merge da questa macchina: il diff da fondere lo guarda il server');
    assert.ok(!/checkout/.test(codice),
      'niente passaggi sul ramo principale per fondere: non serve più, e cambiare ramo sotto i piedi del lavoro è un rischio in sé');
  });

  test('la fusione si CHIEDE, e il ramo viene spedito prima', () => {
    assert.match(codice, /askServerMerge/, 'la fusione passa dal server');
    assert.match(codice, /push['"\s,\]]+.*branch/, 'il ramo va spedito, o il server non ha niente da guardare');
  });

  test('lavorare direttamente sul ramo principale si ferma subito', () => {
    assert.match(codice, /isProtectedBranch\(branch/,
      'un lavoro fatto sul ramo principale non ha più modo di arrivare agli utenti: va detto prima dei controlli');
  });

  test('la guardia non si sposta con una variabile d’ambiente', () => {
    // Il buco: con il ramo principale letto dall'ambiente bastava esportare un
    // nome diverso perché "sei sul ramo principale" diventasse falso — e la
    // riga che spedisce il ramo spedisse il ramo PRINCIPALE su origin con le
    // credenziali di questa macchina, prima ancora di parlare col server.
    assert.ok(!/process\.env\.FILO_MAIN_BRANCH/.test(SORGENTE),
      'il nome del ramo principale è una guardia: non si prende dall’ambiente');
    assert.match(codice, /const MAIN = 'main'/,
      'il ramo principale è un valore inchiodato, non configurabile');
  });

  test('la spedizione del ramo è protetta anche lei, non solo il controllo iniziale', () => {
    // Due guardie sulla stessa cosa: quella all'inizio serve a non far perdere
    // mezz'ora di controlli, questa a non spedire mai il ramo principale.
    const push = codice.indexOf("'push', 'origin'");
    assert.ok(push > 0, 'la spedizione del ramo deve esistere');
    const guardia = codice.lastIndexOf('isProtectedBranch(branch', push);
    assert.ok(guardia > 0, 'prima di spedire si controlla che non sia il ramo principale');
    assert.match(codice.slice(guardia, push), /exit\(1\)/, 'e il controllo deve FERMARE, non avvisare');
    assert.ok(push - guardia < 400, 'la guardia sta attaccata alla spedizione, non a mezzo file di distanza');
  });
});

describe('quale ramo NON si spedisce mai', () => {
  test('il ramo principale non si spedisce, comunque si chiami', () => {
    for (const b of ['main', 'master', 'MAIN', ' main ', 'refs/heads/main', 'origin/main']) {
      assert.equal(isProtectedBranch(b), true, `"${b}" non deve essere spedibile`);
    }
  });

  test('anche il default dichiarato dal repo è protetto, oltre ai nomi inchiodati', () => {
    assert.equal(isProtectedBranch('produzione', 'origin/produzione'), true);
    // …ma il default non SOSTITUISCE i nomi inchiodati: se qualcuno riuscisse a
    // raccontare un default diverso, main resterebbe protetto lo stesso.
    assert.equal(isProtectedBranch('main', 'origin/qualcosaltro'), true);
  });

  test('un ramo di lavoro normale si spedisce', () => {
    for (const b of ['claude/ridisegno-max', 'worker/42', 'mainline', 'feature/main-menu']) {
      assert.equal(isProtectedBranch(b, 'origin/main'), false, `"${b}" deve essere spedibile`);
    }
  });

  test('un ramo che non si sa qual è conta come protetto (nel dubbio non si spedisce)', () => {
    for (const b of ['', null, undefined, '   ', 'HEAD']) {
      assert.equal(isProtectedBranch(b, 'origin/main'), true);
    }
  });
});
