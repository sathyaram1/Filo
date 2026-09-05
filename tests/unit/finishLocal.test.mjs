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

import { specsForChangedFiles, isProtectedBranch, pushArgs, resolveDiffBase, behindMainStop } from '../../scripts/finish-local.mjs';

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

describe('la base del confronto è la linea principale REMOTA (feedback #508)', () => {
  // Il difetto: `git diff main...HEAD` col ref LOCALE di main. Su una macchina
  // col main locale indietro (455 commit, caso vissuto) il diff include il
  // lavoro degli altri già pubblicato e il finish lancia 158 spec invece di 1,
  // inciampando nei rossi altrui.

  test('con la copia remota disponibile la base è origin/main, senza avvisi', () => {
    assert.deepEqual(resolveDiffBase({ fetchOk: true, remoteRefOk: true }), { base: 'origin/main', note: '' });
  });

  test('fetch fallito ma copia remota presente: si usa quella, DICENDOLO', () => {
    const r = resolveDiffBase({ fetchOk: false, remoteRefOk: true });
    assert.equal(r.base, 'origin/main');
    assert.ok(r.note.length > 0, 'un ripiego silenzioso è indistinguibile dal difetto');
  });

  test('senza copia remota: ripiego sul ref locale, mai in silenzio', () => {
    const r = resolveDiffBase({ fetchOk: false, remoteRefOk: false });
    assert.equal(r.base, 'main');
    assert.ok(r.note.length > 0);
  });

  test('il diff degli spec usa la base scelta, non il ref locale di main', () => {
    // Senza il fix questa sentinella è rossa: la funzione può essere giusta e
    // il diff continuare a partire dal ref locale.
    assert.ok(!SORGENTE.includes('${MAIN}...HEAD'),
      'il confronto non deve partire dal ref locale di main');
    assert.match(SORGENTE, /\$\{base\}\.\.\.HEAD/,
      'il confronto parte dalla base scelta (origin/main quando c\'è)');
  });
});

describe('la guardia sul ramo rimasto indietro (caso #500)', () => {
  test('ramo indietro → fermi subito, col rimedio scritto', () => {
    const msg = behindMainStop(3);
    assert.match(msg, /3 commit/);
    assert.match(msg, /verify-local\.mjs start/, 'il messaggio deve dire cosa fare adesso');
  });

  test('ramo pari (o solo avanti) → via libera', () => {
    assert.equal(behindMainStop(0), '');
    assert.equal(behindMainStop(-2), '');
  });

  test('conteggio illeggibile → via libera (la guardia non inventa conflitti)', () => {
    assert.equal(behindMainStop(NaN), '');
    assert.equal(behindMainStop('fatal: qualcosa'), '');
    assert.equal(behindMainStop(undefined), '');
  });

  test('la guardia sta PRIMA dei controlli, non dopo', () => {
    // Meglio 5 secondi di errore chiaro che 15 minuti di controlli seguiti da
    // un conflitto. lastIndexOf: si guarda la CHIAMATA, non la definizione.
    const guardia = SORGENTE.lastIndexOf('behindMainStop(');
    const controlli = SORGENTE.indexOf("'test:unit'");
    assert.ok(guardia > 0 && controlli > 0);
    assert.ok(guardia < controlli, 'il conflitto di fusione va scoperto prima di pagare i controlli');
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
    // (Prima questa sentinella cercava la stringa `'push', 'origin'`; ora gli
    // argomenti del push li costruisce pushArgs — che dichiara anche la
    // destinazione — quindi il punto da sorvegliare è la CHIAMATA.)
    const push = codice.indexOf('git(pushArgs(branch))');
    assert.ok(push > 0, 'la spedizione del ramo deve esistere');
    const guardia = codice.lastIndexOf('isProtectedBranch(branch', push);
    assert.ok(guardia > 0, 'prima di spedire si controlla che non sia il ramo principale');
    assert.match(codice.slice(guardia, push), /exit\(1\)/, 'e il controllo deve FERMARE, non avvisare');
    assert.ok(push - guardia < 400, 'la guardia sta attaccata alla spedizione, non a mezzo file di distanza');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La DESTINAZIONE della spedizione.
//
// `git push origin <ramo>` dice a git COSA spedire, mai DOVE: se manca la parte
// `:<destinazione>`, git la prende dalla configurazione locale. Con
// `push.default=upstream` (o `tracking`) e `branch.<ramo>.merge=refs/heads/main`
// — che git imposta DA SÉ quando un ramo nasce da origin/main, quindi è già così
// su ogni ramo di lavoro di questo repo — la spedizione atterra su
// refs/heads/main mentre il nome del ramo resta innocuo e TUTTE le guardie sul
// nome passano. Sono `git config`: un file non versionato, nessuna credenziale.

const temporanei = [];
function g(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** origin finto (bare) + un clone con un commit su main. */
function repoDiProva() {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-finish-'));
  temporanei.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  g(work, ['init', '-q', '--initial-branch=main']);
  g(work, ['remote', 'add', 'origin', origin]);
  writeFileSync(resolve(work, 'README.md'), 'base\n', 'utf8');
  g(work, ['add', '-A']);
  g(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  g(work, ['push', '-q', 'origin', 'refs/heads/main:refs/heads/main']);
  return { origin, work };
}

test.after(() => {
  for (const d of temporanei) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

describe('la spedizione dice DOVE, non solo cosa', () => {
  test('gli argomenti portano una destinazione pienamente qualificata', () => {
    assert.deepEqual(
      pushArgs('claude/ridisegno-max'),
      ['push', 'origin', 'refs/heads/claude/ridisegno-max:refs/heads/claude/ridisegno-max']
    );
  });

  test('il ramo principale non si spedisce nemmeno passando di qui', () => {
    for (const b of ['main', 'master', 'origin/main', '', null, 'HEAD']) {
      assert.throws(() => pushArgs(b), /spedizione rifiutata/, `"${b}" non deve essere spedibile`);
    }
  });

  test('con la configurazione di git avvelenata il ramo principale NON si muove', () => {
    const { origin, work } = repoDiProva();
    const ramo = 'claude/innocuo';

    // Il ramo nasce da origin/main: è git stesso a scrivere
    // branch.<ramo>.merge = refs/heads/main. Non serve nessun trucco.
    g(work, ['fetch', '-q', 'origin']);
    g(work, ['checkout', '-q', '-b', ramo, 'origin/main']);
    assert.equal(g(work, ['config', '--get', `branch.${ramo}.merge`]), 'refs/heads/main',
      'il presupposto del difetto: git punta il ramo di lavoro al ramo principale da sé');

    writeFileSync(resolve(work, 'lavoro.txt'), 'roba\n', 'utf8');
    g(work, ['add', '-A']);
    g(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'lavoro']);
    const atteso = g(work, ['rev-parse', 'HEAD']);

    // IL VELENO: un `git config` qualunque, su un file che non sta su git.
    g(work, ['config', 'push.default', 'upstream']);
    const mainPrima = g(origin, ['rev-parse', 'refs/heads/main']);

    // La spedizione VERA, con gli argomenti che usa finish-local.
    g(work, pushArgs(ramo));

    // Successo dal punto di vista dell'owner: il lavoro è su origin sul SUO
    // ramo, pronto perché il server lo guardi — e il ramo principale è dove
    // l'ha lasciato il server, non dove l'ha spinto questa macchina.
    const suOrigin = (ref) => { try { return g(origin, ['rev-parse', ref]); } catch (_) { return '(non esiste)'; } };
    assert.equal(suOrigin('refs/heads/main'), mainPrima,
      'il ramo principale non si deve muovere: da questa macchina non ci scrive nessuno');
    assert.equal(suOrigin(`refs/heads/${ramo}`), atteso,
      'il ramo di lavoro deve arrivare su origin col suo nome');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('nessuno spedisce senza dire dove', () => {
  // Sentinella sul SORGENTE di tutti i cammini che pushano: uno solo corretto
  // non basta, perché il difetto è una forma — e la forma si ripropone da sola
  // ogni volta che qualcuno scrive `git push origin <ramo>` per abitudine.
  // L'hook di salvataggio è il caso peggiore: gira a OGNI modifica di file.
  const SORVEGLIATE = ['scripts', '.claude/hooks', '.github/workflows'];
  const ESTENSIONI = ['.mjs', '.js', '.sh', '.yml', '.yaml'];

  function fileSotto(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = resolve(dir, e.name);
      if (e.isDirectory()) fileSotto(p, out);
      else if (ESTENSIONI.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
  }

  /** Via i commenti: nominare il difetto non deve far scattare la sentinella. */
  function senzaCommenti(testo) {
    return testo.split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      })
      .join('\n');
  }

  // shell/yaml: `git push [-flag…] origin <arg>` — <arg> deve contenere ':'
  const SHELL = /git\s+push\s+(?:-[^\s]+\s+)*origin\s+("[^"]*"|'[^']*'|[^\s;|&)]+)/g;
  // javascript: `['push', [-flag…] 'origin', <arg>` — idem, e <arg> può essere
  // un identificatore: è proprio quella la forma che ha aperto il buco.
  const JS = /\[\s*'push'\s*,(?:\s*'-[^']*'\s*,)*\s*'origin'\s*,\s*([^\],]+)/g;

  test('negli script, negli hook e nei workflow ogni push dichiara la destinazione', () => {
    const colpevoli = [];
    for (const d of SORVEGLIATE) {
      for (const f of fileSotto(resolve(ROOT, d))) {
        const testo = senzaCommenti(readFileSync(f, 'utf8'));
        for (const re of [SHELL, JS]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(testo)) !== null) {
            const arg = m[1].trim().replace(/^[`'"]|[`'"]$/g, '');
            if (!arg.includes(':')) colpevoli.push(`${f.slice(ROOT.length + 1)}: ${m[0].trim()}`);
          }
        }
      }
    }
    assert.deepEqual(colpevoli, [],
      'un push senza `sorgente:destinazione` lascia scegliere l’arrivo alla configurazione locale di git, ' +
      'che è un file non versionato: con push.default=upstream il ramo atterra sul ramo principale');
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

// ── Rossi noti: si vedono, non fermano ──────────────────────────────────────
// Un rosso d'ambiente (rosso anche su main su questa macchina) spacciato per
// regressione blocca la pubblicazione di un lavoro sano: l'elenco tracciato
// dice quali sono, e il cancello li separa da quelli che devono essere verdi.
import { splitKnownRed } from '../../scripts/finish-local.mjs';

test('splitKnownRed: i rossi noti escono dal gruppo bloccante, gli altri restano', () => {
  const r = splitKnownRed(['tests/a', 'tests/decks-chat-stress', 'tests/b'], ['tests/decks-chat-stress', 'tests/altro.spec.mjs']);
  assert.deepEqual(r.blocking, ['tests/a', 'tests/b']);
  assert.deepEqual(r.informative, ['tests/decks-chat-stress']);
  assert.deepEqual(splitKnownRed(['tests/a'], null), { blocking: ['tests/a'], informative: [] });
});

test('l\'elenco dei rossi noti è tracciato e ogni voce è uno spec che esiste', () => {
  const j = JSON.parse(readFileSync(resolve(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
  assert.ok(Array.isArray(j.specs) && j.specs.length > 0);
  assert.match(j.nota, /#\d+/, 'l\'elenco cita il feedback che lo svuoterà');
  for (const s of j.specs) assert.ok(existsSync(resolve(ROOT, `${s}.spec.mjs`)), `${s} non esiste più: toglilo dall'elenco`);
});
