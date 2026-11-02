// Un clone per worker (#1157): origin giusto per costruzione, node_modules collegato e mai attraversato, chiavi
// d'accesso copiate senza stamparle, installazione privata solo se il lock cambia, rimozione che toglie prima il
// collegamento. Più il marcatore del worker, che non deve mai finire in un commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { pidMorto } from '../helpers/processi.mjs';
import { createHash } from 'node:crypto';
import {
  MARCA_COLLEGATI, MARCA_PRIVATI, MARCATORE_WORKER, allineaPacchetti, cartellaRegistro, chiaviAccesso, concorrenzaUnit, datiWorker,
  elencoCloni, motivoNpm, preparaClone, stessoRemoto, togliClone,
} from '../../scripts/lib/clone-worker.mjs';
import { fileBlocco } from '../../scripts/lib/pacchetti.mjs';
import { PINNED_PATHS, pinnedDirWorker, pinnedRepoRoot } from '../../scripts/lib/tools-pin.mjs';
import { SESSION_MARKERS } from '../../scripts/lib/branch-integrity.mjs';
import { carattereSicuro } from '../../scripts/lib/carattere-commento.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Nessuna prova installa pacchetti davvero: con lo stesso lock non deve nemmeno provarci.
const npmMai = () => { throw new Error('npm ci lanciato con lo stesso package-lock'); };
const eLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };
const collegato = (clone) => {
  const nm = resolve(clone, 'node_modules');
  return !eLink(nm) && existsSync(resolve(nm, MARCA_COLLEGATI)) && eLink(resolve(nm, 'pacchetto'));
};

/**
 * Origin nudo, principale clonato da lì con node_modules installato fino in fondo (e un canarino dentro), strumenti
 * finti dell'orchestratore. `pacchetti: false`: il principale appena nato, senza installazione.
 */
function scena({ pacchetti = true } = {}) {
  const base = cartellaTemporanea('filo-clone-worker-');
  const origin = resolve(base, 'origin.git');
  mkdirSync(origin);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const principale = resolve(base, 'principale');
  execFileSync('git', ['clone', '-q', origin, principale], { stdio: 'ignore' });
  git(principale, ['config', 'core.autocrlf', 'false']);
  writeFileSync(resolve(principale, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
  writeFileSync(resolve(principale, '.gitignore'), 'node_modules\n', 'utf8');
  git(principale, ['add', '-A']);
  git(principale, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(principale, ['push', '-q', 'origin', 'main']);
  if (pacchetti) {
    mkdirSync(resolve(principale, 'node_modules', 'pacchetto'), { recursive: true });
    writeFileSync(resolve(principale, 'node_modules', 'pacchetto', 'canarino.txt'), 'vivo\n', 'utf8');
    writeFileSync(resolve(principale, 'node_modules', '.package-lock.json'), '{}\n', 'utf8'); // npm lo scrive alla fine
  }
  const strumenti = resolve(base, 'strumenti-orchestratore');
  for (const p of PINNED_PATHS) {
    if (p.endsWith('.js')) { mkdirSync(dirname(resolve(strumenti, p)), { recursive: true }); writeFileSync(resolve(strumenti, p), '', 'utf8'); } else mkdirSync(resolve(strumenti, p), { recursive: true });
  }
  return { base, origin, principale, strumenti, basePin: resolve(base, 'pin'), canarino: resolve(principale, 'node_modules', 'pacchetto', 'canarino.txt') };
}

test('il clone nasce con l\'origin VERO del principale, node_modules collegato, marcatore, registro e strumenti suoi', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const r = preparaClone(s.principale, 1, { dest, paralleli: 3, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(r.ok, true, r.why);
    assert.equal(r.pacchetti, 'collegati');
    const originClone = git(dest, ['remote', 'get-url', 'origin']);
    assert.ok(stessoRemoto(originClone, s.origin), `origin del clone: ${originClone}`);
    assert.ok(!stessoRemoto(originClone, s.principale), 'mai il percorso del principale: spedirebbe li\', in silenzio');
    assert.ok(collegato(dest), 'node_modules e\' una cartella sua con un collegamento per pacchetto');
    assert.ok(existsSync(resolve(dest, 'node_modules', 'pacchetto', 'canarino.txt')), 'che porta a quello del principale');
    assert.deepEqual(JSON.parse(readFileSync(resolve(dest, MARCATORE_WORKER), 'utf8')).indice, 1);
    assert.deepEqual(datiWorker({ env: {}, root: dest }), { indice: 1, paralleli: 3 });
    assert.equal(git(dest, ['status', '--porcelain']), '', 'ne\' il marcatore ne\' il collegamento finiscono in un commit');
    assert.ok(carattereSicuro(git(dest, ['config', '--get', 'core.commentChar'])), 'i titoli `#n` sopravvivono a un rebase nel clone (#762)');
    assert.deepEqual(elencoCloni(s.principale).map((c) => [c.indice, resolve(c.cartella)]), [[1, dest]], 'il registro lo conosce');
    assert.ok(cartellaRegistro(s.principale).startsWith(resolve(s.principale, '.git')), 'e sta dentro la .git del principale');
    assert.equal(r.strumenti, pinnedDirWorker(1, s.basePin));
    assert.equal(pinnedRepoRoot(r.strumenti), dest, 'gli strumenti del worker conoscono il suo clone');

    const di = preparaClone(s.principale, 1, { dest, paralleli: 3, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(di.ok, true, `rilanciato riprende lo stesso clone: ${di.why}`);
  } finally {
    togliCartella(s.base);
  }
});

test('le chiavi d\'accesso locali passano al clone, e non si stampano mai', () => {
  const s = scena();
  try {
    git(s.principale, ['config', 'http.https://example.invalid/.extraheader', 'AUTHORIZATION: basic SEGRETO-1157']);
    git(s.principale, ['config', 'credential.helper', 'store --file=/nessuno']);
    const dest = resolve(s.base, 'lavori', '2');
    const env = { ...process.env, FILO_REPO_ROOT: s.principale, FILO_TOOLS_DIR: s.basePin, FILO_CLONI_DIR: resolve(s.base, 'lavori') };
    const cli = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'clone-worker.mjs'), 'prepara', '2', '--dest', dest], { encoding: 'utf8', env });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(JSON.parse(cli.stdout.trim()).ok, true);
    assert.doesNotMatch(cli.stdout + cli.stderr, /SEGRETO/, 'il valore non compare in nessuna uscita');
    assert.equal(git(dest, ['config', '--get', 'http.https://example.invalid/.extraheader']), 'AUTHORIZATION: basic SEGRETO-1157');
    assert.equal(git(dest, ['config', '--get', 'credential.helper']), 'store --file=/nessuno');
    const tolto = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'clone-worker.mjs'), 'togli', '2'], { encoding: 'utf8', env });
    assert.equal(tolto.status, 0, tolto.stdout + tolto.stderr);
    assert.ok(!existsSync(dest));
  } finally {
    togliCartella(s.base);
  }
});

test('package-lock diverso dal principale: installazione privata, e il node_modules del principale non si tocca', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    assert.equal(preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, true);
    let chiamate = 0;
    const npmCi = (cartella) => { chiamate += 1; mkdirSync(resolve(cartella, 'node_modules', 'privato'), { recursive: true }); return { ok: true }; };
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi }).pacchetti, 'collegati', 'stesso lock: collegati');
    assert.equal(chiamate, 0);
    writeFileSync(resolve(dest, 'package-lock.json'), '{"lockfileVersion":3,"nuovo":true}\n', 'utf8');
    const r = allineaPacchetti(dest, s.principale, { npmCi });
    assert.equal(r.pacchetti, 'privati');
    assert.equal(chiamate, 1);
    assert.ok(!collegato(dest) && !eLink(resolve(dest, 'node_modules')), 'un node_modules suo, senza collegamenti');
    assert.ok(existsSync(s.canarino), 'il principale ha ancora i suoi pacchetti');
    assert.ok(!existsSync(resolve(s.principale, 'node_modules', 'privato')), 'e l\'installazione privata non e\' finita li\'');
    git(dest, ['checkout', '--', 'package-lock.json']);
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi }).pacchetti, 'collegati', 'tornato uguale: di nuovo collegati');
    assert.ok(collegato(dest));
  } finally {
    togliCartella(s.base);
  }
});

test('chi svuota il node_modules del clone da dentro, come npm ci, toglie i collegamenti e non i pacchetti del principale', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    assert.equal(preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, true);
    // npm ci legge le voci di node_modules e le toglie una per una, ricorsivamente.
    const nm = resolve(dest, 'node_modules');
    for (const voce of readdirSync(nm)) assert.ok(togliCartella(resolve(nm, voce)));
    assert.ok(existsSync(s.canarino), 'il principale ha ancora i suoi pacchetti');

    // Un clone nato col collegamento intero si riallinea voce per voce.
    assert.ok(togliCartella(nm));
    symlinkSync(resolve(s.principale, 'node_modules'), nm, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi: npmMai }).pacchetti, 'collegati');
    assert.ok(collegato(dest));
    assert.ok(existsSync(s.canarino));
  } finally {
    togliCartella(s.base);
  }
});

/** Un npm ci finto che lascia un pacchetto privato nel clone e conta le volte. */
function npmFinto() {
  const f = (cartella) => { f.chiamate += 1; mkdirSync(resolve(cartella, 'node_modules', 'privato'), { recursive: true }); return { ok: true }; };
  f.chiamate = 0;
  return f;
}
const firmaDi = (clone) => createHash('sha1').update(readFileSync(resolve(clone, 'package-lock.json'), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('principale senza pacchetti: il clone li installa da se\', una volta, invece di rifiutare (#1906)', () => {
  const s = scena({ pacchetti: false });
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const avvisi = [];
    const npmCi = npmFinto();
    // Come lo chiede dispatch, che non puo' aspettare un npm ci quando c'e' qualcosa da collegare.
    const opz = { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi, soloCollegati: true, avvisa: (m) => avvisi.push(m) };
    const r = preparaClone(s.principale, 1, opz);
    assert.equal(r.ok, true, r.why);
    assert.equal(r.pacchetti, 'privati');
    assert.equal(npmCi.chiamate, 1);
    assert.ok(existsSync(resolve(dest, 'node_modules', 'privato')), 'i pacchetti stanno nel clone');
    assert.ok(!existsSync(resolve(s.principale, 'node_modules')), 'e il principale resta com\'era');
    assert.match(avvisi.join('\n'), /principale non ha i pacchetti/, 'chi lancia sa perche\' aspetta');
    assert.equal(git(dest, ['status', '--porcelain']), '', 'l\'installazione non finisce in un commit');

    // Il giro dopo, e il dispatch nel clone, tengono l'installazione: non si paga due volte.
    assert.equal(preparaClone(s.principale, 1, opz).ok, true);
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi, soloCollegati: true }).pacchetti, 'privati');
    assert.equal(npmCi.chiamate, 1);
    // Un ramo con un altro lock non aspetta un'altra installazione: tiene quella che c'e', e lo dice.
    writeFileSync(resolve(dest, 'package-lock.json'), '{"lockfileVersion":3,"ramo":true}\n', 'utf8');
    const ramo = allineaPacchetti(dest, s.principale, { npmCi, soloCollegati: true });
    assert.deepEqual([ramo.pacchetti, ramo.lockDiverso, npmCi.chiamate], ['privati', true, 1]);
    // Chi puo' aspettare (il comando dei clone) installa per il lock nuovo.
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi, avvisa: () => {} }).pacchetti, 'privati');
    assert.equal(npmCi.chiamate, 2);
  } finally {
    togliCartella(s.base);
  }
});

test('principale a meta\' installazione: il clone non collega i pacchetti a meta\', li installa', () => {
  const s = scena({ pacchetti: false });
  try {
    mkdirSync(resolve(s.principale, 'node_modules', 'pacchetto'), { recursive: true }); // npm ci al lavoro
    const dest = resolve(s.base, 'lavori', '1');
    const npmCi = npmFinto();
    const r = preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi, soloCollegati: true, avvisa: () => {} });
    assert.equal(r.pacchetti, 'privati', r.why);
    assert.equal(npmCi.chiamate, 1);
    assert.ok(!existsSync(resolve(dest, 'node_modules', 'pacchetto')), 'niente collegamenti a un\'installazione a meta\'');
    // Finita quella del principale, col lock uguale il clone tiene la sua.
    writeFileSync(resolve(s.principale, 'node_modules', '.package-lock.json'), '{}\n', 'utf8');
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi: npmMai, soloCollegati: true }).pacchetti, 'privati');
  } finally {
    togliCartella(s.base);
  }
});

test('installazione non riuscita: il motivo di npm e il gruppo del guasto, e il giro dopo riprende lo stesso clone', () => {
  const s = scena({ pacchetti: false });
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const opz = { dest, strumentiDa: s.strumenti, basePin: s.basePin, soloCollegati: true, avvisa: () => {} };
    const r = preparaClone(s.principale, 1, { ...opz, npmCi: () => ({ ok: false, why: 'npm ci uscito con 1: npm error code ENOTFOUND' }) });
    assert.equal(r.ok, false);
    assert.match(r.why, /ENOTFOUND/, 'il guasto dice perche\'');
    assert.equal(r.gruppo, 'npm');
    assert.ok(!existsSync(resolve(dest, 'node_modules', MARCA_PRIVATI)), 'senza impronta: il prossimo riprova');
    const npmCi = npmFinto();
    const di = preparaClone(s.principale, 1, { ...opz, npmCi });
    assert.equal(di.ok, true, `tornata la rete, il clone rimasto si riprende: ${di.why}`);
    assert.equal(npmCi.chiamate, 1);
  } finally {
    togliCartella(s.base);
  }
});

test('rilanciato mentre un altro installa nel clone: aspetta quella, e un blocco di un processo morto non lo ferma', () => {
  const s = scena({ pacchetti: false });
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const blocchi = resolve(s.base, 'blocchi');
    mkdirSync(blocchi);
    assert.equal(preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmFinto(), soloCollegati: true, avvisa: () => {} }).ok, true);
    togliCartella(resolve(dest, 'node_modules'));
    const f = fileBlocco(dest, blocchi);

    // Il primo dispatch, spostato in sottofondo dal tempo del comando, sta ancora installando.
    writeFileSync(f, `${process.pid}\n`, 'utf8');
    let t = 0;
    const attendi = (ms) => {
      t += ms;
      if (t < 3000) return;
      mkdirSync(resolve(dest, 'node_modules'), { recursive: true });
      writeFileSync(resolve(dest, 'node_modules', MARCA_PRIVATI), `${firmaDi(dest)}\n`, 'utf8');
      togliCartella(f);
    };
    const avvisi = [];
    const r = allineaPacchetti(dest, s.principale, { npmCi: npmMai, soloCollegati: true, blocchi, ora: () => t, attendi, avvisa: (m) => avvisi.push(m) });
    assert.equal(r.pacchetti, 'privati', r.why);
    assert.ok(t >= 3000, 'ha aspettato la fine dell\'altra');
    assert.match(avvisi.join('\n'), /altra installazione/);

    // Il primo e' stato fermato dal tempo del comando: il blocco resta, col pid di un processo che non c'e' piu'.
    togliCartella(resolve(dest, 'node_modules'));
    writeFileSync(f, `${pidMorto()}\n`, 'utf8');
    const npmCi = npmFinto();
    const di = allineaPacchetti(dest, s.principale, {
      npmCi, soloCollegati: true, blocchi, attendi: () => { throw new Error('ha aspettato un blocco morto'); }, avvisa: () => {},
    });
    assert.equal(di.pacchetti, 'privati', di.why);
    assert.equal(npmCi.chiamate, 1);
    assert.ok(!existsSync(f), 'e il blocco se ne va con lui');
  } finally {
    togliCartella(s.base);
  }
});

test('la rimozione toglie il collegamento PRIMA della cartella: il principale resta intero', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const r = preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(r.ok, true, r.why);
    const t = togliClone(s.principale, 1, { basePin: s.basePin });
    assert.equal(t.ok, true, t.why);
    assert.ok(!existsSync(dest), 'il clone non c\'e\' piu\'');
    assert.ok(existsSync(s.canarino), 'il node_modules del principale e\' intatto');
    assert.deepEqual(elencoCloni(s.principale), [], 'la voce del registro se ne va');
    assert.ok(!existsSync(r.strumenti), 'e gli strumenti del worker pure');

    const estranea = resolve(s.base, 'estranea');
    mkdirSync(estranea, { recursive: true });
    writeFileSync(resolve(estranea, 'cosa.txt'), 'x\n', 'utf8');
    const no = togliClone(s.principale, 3, { dest: estranea, basePin: s.basePin });
    assert.equal(no.ok, false, 'una cartella senza il marcatore del worker non si toglie');
    assert.ok(existsSync(resolve(estranea, 'cosa.txt')));
    assert.equal(preparaClone(s.principale, 3, { dest: estranea, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, false, 'e non si usa come clone');
  } finally {
    togliCartella(s.base);
  }
});

test('la misura di K, fuori dal registro, non toglie il worker vero che ha lo stesso numero', () => {
  const s = scena();
  try {
    const vero = resolve(s.base, 'lavori', '1');
    assert.equal(preparaClone(s.principale, 1, { dest: vero, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, true);
    const registrati = () => elencoCloni(s.principale).map((c) => resolve(c.cartella));
    const pinMisura = resolve(s.base, 'pin-misura');
    const misura = resolve(s.base, 'misura', 'clone-1');
    const m = preparaClone(s.principale, 1, { dest: misura, strumentiDa: s.strumenti, basePin: pinMisura, npmCi: npmMai, registra: false });
    assert.equal(m.ok, true, m.why);
    assert.deepEqual(registrati(), [vero], 'il clone della misura non entra nel registro');
    assert.equal(togliClone(s.principale, 1, { dest: misura, basePin: pinMisura, registra: false }).ok, true);
    assert.deepEqual(registrati(), [vero], 'e togliendolo il worker vero resta');

    const altro = resolve(s.base, 'altro', '1');
    assert.equal(preparaClone(s.principale, 1, { dest: altro, strumentiDa: s.strumenti, basePin: pinMisura, npmCi: npmMai, registra: false }).ok, true);
    assert.equal(togliClone(s.principale, 1, { dest: altro, basePin: pinMisura }).ok, true);
    assert.deepEqual(registrati(), [vero], 'una voce che punta a un\'altra cartella non se ne va col dest di qualcun altro');
    assert.ok(existsSync(s.canarino));

    assert.equal(togliClone(s.principale, 1, { basePin: s.basePin }).ok, true);
    assert.deepEqual(registrati(), [], 'il worker vero, tolto lui, esce dal registro');
  } finally {
    togliCartella(s.base);
  }
});

test('stessoRemoto, chiaviAccesso, datiWorker, concorrenzaUnit: le parti pure', () => {
  assert.ok(stessoRemoto('https://github.com/Sathyaram1/Filo.git', 'https://github.com/sathyaram1/filo/'));
  assert.ok(!stessoRemoto('https://github.com/sathyaram1/filo', 'C:/Users/x/Filo'));
  assert.ok(!stessoRemoto('', ''), 'nessun origin non e\' lo stesso origin');
  const voci = chiaviAccesso('core.autocrlf\nfalse\0http.https://github.com/.extraheader\nAUTHORIZATION: x y\0credential.helper\nstore\0user.name\nio\0');
  assert.deepEqual(voci, [['http.https://github.com/.extraheader', 'AUTHORIZATION: x y'], ['credential.helper', 'store']]);
  assert.deepEqual(datiWorker({ env: { FILO_WORKER: '2', FILO_WORKER_PARALLELI: '4' } }), { indice: 2, paralleli: 4 });
  assert.equal(datiWorker({ env: {} }), null, 'fuori da un clone di worker: niente');
  assert.equal(datiWorker({ env: { FILO_WORKER: 'x' } }), null);
  assert.equal(concorrenzaUnit(4, 16), 4);
  assert.equal(concorrenzaUnit(3, 2), 1);
  assert.equal(concorrenzaUnit(1, 16), 0, 'un worker solo: decide node');
  const uscita = 'npm error code ENOTFOUND\nnpm error\nnpm error syscall getaddrinfo\nnpm error A complete log of this run can be found in: /x.log\n';
  assert.equal(motivoNpm(uscita), 'npm error code ENOTFOUND / npm error syscall getaddrinfo');
  assert.equal(motivoNpm('qualcosa\nl\'ultima riga\n'), 'l\'ultima riga', 'senza righe d\'errore di npm, l\'ultima');
  assert.equal(motivoNpm(''), '');
});

test('il marcatore del worker e\' un file di sessione: in .gitignore e fra i marcatori esclusi', () => {
  assert.ok(SESSION_MARKERS.includes(MARCATORE_WORKER));
  const ignorati = readFileSync(resolve(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignorati.includes(MARCATORE_WORKER), `${MARCATORE_WORKER} manca in .gitignore`);
});

test('il clone nasce anche quando il principale ha l\'indice dei commit sulla cima del ramo', () => {
  // Verifica #1157 giro 5: col prestito e il distacco l'indice faceva fallire l'apertura dei file. Con l'origin scritto
  // come percorso git copia gli oggetti da sé e il caso non si vede: qui è un indirizzo, come quello di GitHub.
  const s = scena();
  try {
    git(s.principale, ['remote', 'set-url', 'origin', pathToFileURL(s.origin).href]);
    git(s.principale, ['commit-graph', 'write', '--reachable']);
    const dest = resolve(s.base, 'lavori', '1');
    const r = preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai, registra: false });
    assert.equal(r.ok, true, r.why);
    assert.ok(existsSync(resolve(dest, 'package-lock.json')), 'i file del ramo ci sono');
  } finally {
    togliCartella(s.base);
  }
});
