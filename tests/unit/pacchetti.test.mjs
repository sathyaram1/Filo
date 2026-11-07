// Avviare Filo dai sorgenti installa i pacchetti nuovi del lock (#1572) senza sostituire un Electron acceso, le prove di un
// albero completano col suo lock un node_modules non suo (#1572.1), e il pacchetto installato porta ogni libreria che
// src/ richiede. Le regole di scripts/lib/pacchetti.mjs e del pre-avvio.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules, createRequire } from 'node:module';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  ammesso, vociRichieste, baseDeiPacchetti, pacchettiDaInstallare, descrivi, electronInUso, allineaPacchetti, fileBlocco,
  allineaPerLeProve, completaPacchetti, progettoDiAppoggio, primoLivello, MARCA_COLLEGATI, TETTO_INSTALLAZIONE_MS,
} from '../../scripts/lib/pacchetti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

function metti(dir, percorso, versione) {
  mkdirSync(join(dir, percorso), { recursive: true });
  writeFileSync(join(dir, percorso, 'package.json'), JSON.stringify({ name: percorso.split('node_modules/').pop(), version: versione }));
}

function progetto(voci, installati = {}, { nodeModules = true } = {}) {
  const dir = cartellaTemporanea('filo-pacchetti-');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
    name: 'prova', lockfileVersion: 3, packages: { '': { name: 'prova', version: '1.0.0' }, ...voci },
  }));
  if (nodeModules) mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const [p, v] of Object.entries(installati)) metti(dir, p, v);
  return dir;
}

// Le strade che una prova non deve prendere.
const allineaMai = () => { throw new Error('npm install lanciato in un node_modules non suo'); };
const completaMai = () => { throw new Error('completato un node_modules che è dell\'albero'); };

const LOCK_FILO = {
  'node_modules/electron': { version: '44.7.0', dev: true },
  'node_modules/hash-wasm': { version: '4.12.0' },
};

describe('quali pacchetti mancano', () => {
  test('la lamentela: hash-wasm è nel lock e non in node_modules, Electron è già quello giusto', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      assert.deepEqual(pacchettiDaInstallare(dir).map((v) => [v.nome, v.versione, v.trovata]), [['hash-wasm', '4.12.0', null]]);
    } finally { togliCartella(dir); }
  });

  test('una versione diversa da quella del lock va reinstallata, anche se annidata', () => {
    const dir = progetto({
      ...LOCK_FILO,
      'node_modules/a': { version: '1.0.0' },
      'node_modules/a/node_modules/b': { version: '2.0.0' },
    }, {
      'node_modules/electron': '44.6.0', 'node_modules/hash-wasm': '4.12.0', 'node_modules/a': '1.0.0', 'node_modules/a/node_modules/b': '1.9.0',
    });
    try {
      assert.deepEqual(pacchettiDaInstallare(dir).map((v) => [v.percorso, v.trovata]),
        [['node_modules/electron', '44.6.0'], ['node_modules/a/node_modules/b', '1.9.0']]);
    } finally { togliCartella(dir); }
  });

  test('tutto allineato, o senza lock: niente da installare', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0', 'node_modules/hash-wasm': '4.12.0' });
    try {
      assert.deepEqual(pacchettiDaInstallare(dir), []);
      rmSync(join(dir, 'package-lock.json'));
      assert.deepEqual(pacchettiDaInstallare(dir), []);
    } finally { togliCartella(dir); }
  });

  test('un clone appena fatto, senza node_modules: manca tutto', (t) => {
    const dir = progetto(LOCK_FILO, {}, { nodeModules: false });
    try {
      if (baseDeiPacchetti(dir) !== null) return t.skip('la temporanea di sistema ha un node_modules sopra di sé');
      assert.equal(pacchettiDaInstallare(dir).length, 2);
    } finally { togliCartella(dir); }
  });

  test('un worktree senza node_modules si giudica su quello da cui Node risolve, la cartella sopra', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0', 'node_modules/hash-wasm': '4.12.0' });
    const wt = join(dir, '.claude', 'worktrees', 'x');
    try {
      mkdirSync(wt, { recursive: true });
      copyFileSync(join(dir, 'package-lock.json'), join(wt, 'package-lock.json'));
      assert.equal(baseDeiPacchetti(wt), baseDeiPacchetti(dir));
      assert.deepEqual(pacchettiDaInstallare(wt), [], 'con lo stesso lock non serve un node_modules privato');
      const lock = JSON.parse(readFileSync(join(wt, 'package-lock.json'), 'utf8'));
      lock.packages['node_modules/unpdf'] = { version: '1.8.1' };
      writeFileSync(join(wt, 'package-lock.json'), JSON.stringify(lock));
      assert.deepEqual(pacchettiDaInstallare(wt).map((v) => v.nome), ['unpdf']);
    } finally { togliCartella(dir); }
  });

  test('facoltativi, collegamenti e pacchetti di un altro sistema non si chiedono; dev e peer sì', () => {
    const lock = { packages: {
      '': { name: 'prova' },
      'node_modules/fsevents': { version: '2.3.2', optional: true, os: ['darwin'] },
      'node_modules/crc': { version: '3.8.0', optional: true, dev: true },
      'node_modules/misto': { version: '1.0.0', devOptional: true },
      'node_modules/locale': { link: true, resolved: 'pacchetti/locale' },
      'node_modules/solo-mac': { version: '1.0.0', os: ['darwin'] },
      'node_modules/non-arm': { version: '1.0.0', cpu: ['!arm64'] },
      'pacchetti/locale': { version: '1.0.0' },
      'node_modules/archiver': { version: '5.3.2', dev: true, peer: true },
      'node_modules/hash-wasm': { version: '4.12.0' },
    } };
    assert.deepEqual(vociRichieste(lock, { platform: 'win32', arch: 'x64' }).map((v) => v.nome), ['non-arm', 'archiver', 'hash-wasm']);
    assert.deepEqual(vociRichieste(lock, { platform: 'darwin', arch: 'arm64' }).map((v) => v.nome), ['solo-mac', 'archiver', 'hash-wasm']);
    assert.deepEqual(vociRichieste(null), []);
    assert.deepEqual(vociRichieste({ lockfileVersion: 1, dependencies: {} }), []);
  });

  test('os e cpu come li legge npm', () => {
    assert.equal(ammesso(undefined, 'win32'), true);
    assert.equal(ammesso([], 'win32'), true);
    assert.equal(ammesso(['darwin', 'linux'], 'win32'), false);
    assert.equal(ammesso(['darwin', 'linux'], 'linux'), true);
    assert.equal(ammesso(['!win32'], 'win32'), false);
    assert.equal(ammesso(['!win32'], 'linux'), true);
  });

  test('l\'elenco nel messaggio dice quanti ne restano fuori', () => {
    const voci = Array.from({ length: 9 }, (_, i) => ({ nome: `p${i}`, versione: '1.0.0' }));
    assert.equal(descrivi(voci.slice(0, 1)), 'p0 1.0.0');
    assert.match(descrivi(voci), /p5 1\.0\.0 e altri 3$/);
  });
});

describe('installare senza rompere niente', () => {
  const installatoreFinto = (dir, metteDentro) => {
    const chiamate = [];
    return { chiamate, installa: (r) => { chiamate.push(r); for (const [p, v] of Object.entries(metteDentro)) metti(dir, p, v); return { codice: 0, errore: '' }; } };
  };

  test('quando manca hash-wasm lo installa, e dopo non c\'è altro da fare', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      const f = installatoreFinto(dir, { 'node_modules/hash-wasm': '4.12.0' });
      const righe = [];
      const r = allineaPacchetti(dir, { installa: f.installa, inUso: () => true, log: (s) => righe.push(s) });
      assert.equal(r.esito, 'installati');
      assert.deepEqual(f.chiamate, [dir]);
      assert.match(righe.join('\n'), /hash-wasm 4\.12\.0/);
      assert.equal(allineaPacchetti(dir, { installa: f.installa, log: () => {} }).esito, 'allineati');
      assert.equal(f.chiamate.length, 1, 'già allineati: npm non si chiama');
    } finally { togliCartella(dir); }
  });

  test('con Filo aperto: se Electron va sostituito aspetta il prossimo avvio, e npm non parte', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.6.0' });
    try {
      const f = installatoreFinto(dir, {});
      const righe = [];
      const r = allineaPacchetti(dir, { installa: f.installa, inUso: () => true, log: (s) => righe.push(s) });
      assert.equal(r.esito, 'rimandati');
      assert.deepEqual(f.chiamate, []);
      assert.match(righe.join('\n'), /chiudilo e riavvia Filo/);
      assert.equal(allineaPacchetti(dir, { installa: f.installa, inUso: () => false, log: () => {} }).esito, 'non riuscita');
      assert.deepEqual(f.chiamate, [dir], 'a Electron spento si installa');
    } finally { togliCartella(dir); }
  });

  test('npm che fallisce, o finisce senza installare, non ferma l\'avvio e lo dice', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      const comune = { cartellaBlocchi: dir, attendi: () => { throw new Error('il blocco di prima non è stato tolto'); } };
      for (const risposta of [{ codice: 1, errore: '' }, { codice: 0, errore: '' }, undefined]) {
        const righe = [];
        const r = allineaPacchetti(dir, { ...comune, installa: () => risposta, log: (s) => righe.push(s) });
        assert.equal(r.esito, 'non riuscita');
        assert.deepEqual(r.mancanti.map((v) => v.nome), ['hash-wasm']);
        assert.match(righe.at(-1), /mancano ancora: hash-wasm 4\.12\.0\. Filo parte lo stesso/);
      }
      const r = allineaPacchetti(dir, { ...comune, installa: () => { throw new Error('spawn npm ENOENT'); }, log: () => {} });
      assert.equal(r.esito, 'non riuscita');
      assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.lock')), [], 'il blocco se ne va anche quando npm cade');
    } finally { togliCartella(dir); }
  });

  test('il doppio clic: il secondo avvio aspetta l\'installazione del primo invece di farne un\'altra insieme', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      const blocco = fileBlocco(dir, dir);
      const secondo = installatoreFinto(dir, {});
      const righe = [];
      const primo = installatoreFinto(dir, { 'node_modules/hash-wasm': '4.12.0' });
      const r = allineaPacchetti(dir, {
        cartellaBlocchi: dir, log: () => {},
        installa: (x) => {
          assert.ok(existsSync(blocco), 'chi installa tiene il blocco');
          // Mentre il primo installa parte il secondo; la sua attesa è il tempo in cui il primo finisce.
          const r2 = allineaPacchetti(dir, {
            cartellaBlocchi: dir, installa: secondo.installa, log: (s) => righe.push(s),
            attendi: () => { primo.installa(x); rmSync(blocco); },
          });
          assert.equal(r2.esito, 'allineati', 'finito il primo, al secondo non resta niente');
          return { codice: 0, errore: '' };
        },
      });
      assert.equal(r.esito, 'installati');
      assert.equal(primo.chiamate.length, 1);
      assert.deepEqual(secondo.chiamate, [], 'npm non è partito due volte insieme');
      assert.match(righe.join('\n'), /Un altro avvio sta installando/);
      assert.equal(existsSync(blocco), false);
    } finally { togliCartella(dir); }
  });

  test('un blocco rimasto da un avvio morto a metà non ferma per sempre: oltre il tetto si riprende', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      writeFileSync(fileBlocco(dir, dir), '');
      const f = installatoreFinto(dir, { 'node_modules/hash-wasm': '4.12.0' });
      const dopo = () => Date.now() + TETTO_INSTALLAZIONE_MS + 60_000;
      const nonAspettare = () => { throw new Error('non doveva aspettare'); };
      assert.equal(allineaPacchetti(dir, { cartellaBlocchi: dir, installa: f.installa, log: () => {}, ora: dopo, attendi: nonAspettare }).esito, 'installati');
      assert.equal(existsSync(fileBlocco(dir, dir)), false);
    } finally { togliCartella(dir); }
  });

  test('Electron acceso: su Windows l\'eseguibile non si apre in scrittura, altrove non conta', () => {
    const dir = progetto({});
    try {
      const el = join(dir, 'node_modules', 'electron');
      assert.equal(electronInUso(dir, { platform: 'win32' }), false, 'senza binario non c\'è niente di acceso');
      mkdirSync(join(el, 'dist'), { recursive: true });
      writeFileSync(join(el, 'path.txt'), 'electron.exe');
      writeFileSync(join(el, 'dist', 'electron.exe'), '');
      const occupato = () => { throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' }); };
      assert.equal(electronInUso(dir, { platform: 'win32', apri: occupato }), true);
      assert.equal(electronInUso(dir, { platform: 'win32' }), false);
      assert.equal(electronInUso(dir, { platform: 'win32', apri: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } }), false);
      for (const platform of ['darwin', 'linux']) assert.equal(electronInUso(dir, { platform, apri: occupato }), false);
    } finally { togliCartella(dir); }
  });
});

describe('prima delle prove (verifica #1572 giro 1, r1)', () => {
  // Il proprietario del node_modules: npm installa solo lì, col suo lock, e i pacchetti finiti lì sono quelli che le prove vedono.
  const conNpmFinto = (proprietario, metteDentro) => {
    const chiamate = [];
    const allinea = (d, o) => allineaPacchetti(d, {
      ...o, inUso: () => false, cartellaBlocchi: proprietario,
      installa: (r) => { chiamate.push(r); for (const [p, v] of Object.entries(metteDentro)) metti(proprietario, p, v); return { codice: 0, errore: '' }; },
    });
    return { chiamate, allinea };
  };
  const reale = (d) => realpathSync(d);

  test('le prove lanciate nella cartella principale installano la libreria nuova prima di partire', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    try {
      const f = conNpmFinto(dir, { 'node_modules/hash-wasm': '4.12.0' });
      const r = allineaPerLeProve(dir, { allinea: f.allinea, completa: completaMai, log: () => {} });
      assert.equal(r.esito, 'installati');
      assert.deepEqual(f.chiamate.map(reale), [reale(dir)]);
      assert.deepEqual(pacchettiDaInstallare(dir), []);
      assert.equal(allineaPerLeProve(dir, { allinea: f.allinea, completa: completaMai, log: () => {} }).esito, 'allineati');
      assert.equal(f.chiamate.length, 1, 'già allineati: npm non si chiama');
    } finally { togliCartella(dir); }
  });

  test('test:unit e gli spec Playwright passano dal controllo prima di partire', () => {
    const unit = readFileSync(join(ROOT, 'scripts', 'run-unit-tests.mjs'), 'utf8');
    assert.match(unit, /allineaPerLeProve\(REPO_ROOT/);
    const setup = readFileSync(join(ROOT, 'tests', 'fixtures', 'prima-della-corsa.mjs'), 'utf8');
    assert.match(setup, /allineaPerLeProve\(radice/);
    assert.match(readFileSync(join(ROOT, 'playwright.config.js'), 'utf8'), /globalSetup: '\.\/tests\/fixtures\/prima-della-corsa\.mjs'/);
  });

  test('la chiusura e la prova sulla fusione lanciano gli unit e gli spec dall\'albero sotto prova, che si controlla da sé', () => {
    // Il lanciatore e la config di Playwright sono quelli dell'albero: la radice che danno al controllo è la sua (#1572.1).
    const finish = readFileSync(join(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
    assert.match(finish, /run\(process\.execPath, \[join\(albero\.dir, 'scripts', 'run-unit-tests\.mjs'\)\], 'Controlli di logica', undefined, albero\.dir\)/);
    assert.match(finish, /run\(l\.cmd, l\.args, label \+ suffisso, (?:env\()?l\.env\)?, albero\.dir\)/);
    const fusione = readFileSync(join(ROOT, 'scripts', 'lib', 'unit-sulla-fusione.mjs'), 'utf8');
    assert.match(fusione, /const runner = join\(dir, 'scripts', 'run-unit-tests\.mjs'\)/);
    assert.match(fusione, /spawnSync\(process\.execPath, args, \{ cwd: dir,/);
  });
});

// Un albero che prende i pacchetti da un node_modules non suo (un worktree, la cartella di prova di finish, un clone
// collegato voce per voce) si giudica col SUO lock, e lì si aggiunge soltanto (#1572.1, #830.5, #1209.1).
describe('il node_modules di un\'altra cartella si completa, non si cambia', () => {
  // npm finto: mette nell'appoggio le voci del lock parziale che riceve, come farebbe npm col lock.
  const npmFinto = ({ codice = 0 } = {}) => {
    const chiamate = [];
    const installa = (appoggio) => {
      const pacchetto = JSON.parse(readFileSync(join(appoggio, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(join(appoggio, 'package-lock.json'), 'utf8'));
      chiamate.push({ appoggio, dipendenze: pacchetto.dependencies, voci: Object.keys(lock.packages).filter(Boolean) });
      if (codice === 0) for (const [p, v] of Object.entries(lock.packages)) if (p) metti(appoggio, p, v.version);
      return { codice, errore: '' };
    };
    return { chiamate, installa };
  };
  const conNpm = (f, cartellaBlocchi) => ({
    allinea: allineaMai, log: () => {},
    completa: (r, o) => completaPacchetti(r, { ...o, installa: f.installa, cartellaBlocchi }),
  });
  const versioneIn = (dir, p) => { try { return JSON.parse(readFileSync(join(dir, p, 'package.json'), 'utf8')).version; } catch (_) { return null; } };
  const lockCon = (dir, voci) => writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
    name: 'prova', lockfileVersion: 3, packages: { '': { name: 'prova', version: '1.0.0' }, ...voci },
  }));
  const appoggiRimasti = (nm) => readdirSync(nm).filter((n) => n.startsWith('.filo-complemento-'));
  const LOCK_NUOVO = { ...LOCK_FILO, 'node_modules/hunspell-wasm': { version: '0.3.0' } };

  test('la lamentela: principale col lock vecchio, worktree col lock nuovo: la libreria nuova arriva, le altre voci restano', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0', 'node_modules/hash-wasm': '4.12.0', 'node_modules/vecchia': '1.0.0' });
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    try {
      mkdirSync(wt, { recursive: true });
      lockCon(wt, LOCK_NUOVO);
      const lockPrincipale = readFileSync(join(dir, 'package-lock.json'), 'utf8');
      const f = npmFinto();
      const righe = [];
      assert.deepEqual(pacchettiDaInstallare(wt).map((v) => v.nome), ['hunspell-wasm'], 'il controllo la elenca');
      const r = allineaPerLeProve(wt, { ...conNpm(f, dir), log: (s) => righe.push(s) });
      assert.equal(r.esito, 'installati');
      assert.deepEqual(f.chiamate.map((c) => c.dipendenze), [{ 'hunspell-wasm': '0.3.0' }], 'npm riceve la sola libreria nuova');
      assert.equal(versioneIn(dir, 'node_modules/hunspell-wasm'), '0.3.0');
      assert.deepEqual([versioneIn(dir, 'node_modules/electron'), versioneIn(dir, 'node_modules/hash-wasm'), versioneIn(dir, 'node_modules/vecchia')],
        ['44.7.0', '4.12.0', '1.0.0'], 'niente tolto né cambiato nella principale');
      assert.equal(readFileSync(join(dir, 'package-lock.json'), 'utf8'), lockPrincipale);
      assert.equal(existsSync(join(wt, 'node_modules')), false, 'mai un albero intero nel worktree');
      assert.deepEqual(appoggiRimasti(join(dir, 'node_modules')), []);
      assert.match(righe.join('\n'), /hunspell-wasm 0\.3\.0\. Gli altri restano com'erano/);
      assert.equal(allineaPerLeProve(wt, conNpm(f, dir)).esito, 'allineati');
      assert.equal(f.chiamate.length, 1, 'aggiunta una volta, la prova dopo non chiama npm');
    } finally { togliCartella(dir); }
  });

  test('dalla cartella di prova di finish, col node_modules collegato, si aggiunge dove il collegamento porta', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0', 'node_modules/hash-wasm': '4.12.0' });
    const prova = cartellaTemporanea('filo-fusione-');
    try {
      symlinkSync(join(dir, 'node_modules'), join(prova, 'node_modules'), 'junction');
      const albero = join(prova, 'fusione');
      mkdirSync(albero);
      lockCon(albero, LOCK_NUOVO);
      const f = npmFinto();
      const r = allineaPerLeProve(albero, conNpm(f, dir));
      assert.equal(r.esito, 'installati');
      assert.equal(versioneIn(dir, 'node_modules/hunspell-wasm'), '0.3.0');
      assert.deepEqual(pacchettiDaInstallare(albero), []);
      assert.ok(lstatSync(join(prova, 'node_modules')).isSymbolicLink(), 'il collegamento resta un collegamento');
    } finally {
      try { rmSync(join(prova, 'node_modules')); } catch (_) { /* già tolto */ }
      togliCartella(prova);
      togliCartella(dir);
    }
  });

  test('nel clone di un worker collegato voce per voce arrivano hunspell-wasm e hash-wasm, e i collegamenti restano', () => {
    const principale = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0', 'node_modules/@a/b': '1.0.0' });
    const clone = cartellaTemporanea('filo-clone-');
    try {
      const nm = join(clone, 'node_modules');
      mkdirSync(join(nm, '@a'), { recursive: true });
      symlinkSync(join(principale, 'node_modules', 'electron'), join(nm, 'electron'), 'junction');
      symlinkSync(join(principale, 'node_modules', '@a', 'b'), join(nm, '@a', 'b'), 'junction');
      writeFileSync(join(nm, MARCA_COLLEGATI), `${join(principale, 'node_modules')}\n`);
      lockCon(clone, { ...LOCK_NUOVO, 'node_modules/@a/b': { version: '1.0.0' }, 'node_modules/@a/c': { version: '2.0.0' } });
      assert.deepEqual(pacchettiDaInstallare(clone).map((v) => v.nome), ['hash-wasm', 'hunspell-wasm', '@a/c'], 'il controllo le elenca');
      const f = npmFinto();
      const r = allineaPerLeProve(clone, conNpm(f, clone));
      assert.equal(r.esito, 'installati', 'non un npm install nel clone, che sostituirebbe ogni collegamento');
      assert.deepEqual(Object.keys(f.chiamate[0].dipendenze), ['@a/c', 'hash-wasm', 'hunspell-wasm']);
      assert.deepEqual([versioneIn(clone, 'node_modules/hash-wasm'), versioneIn(clone, 'node_modules/hunspell-wasm'), versioneIn(clone, 'node_modules/@a/c')],
        ['4.12.0', '0.3.0', '2.0.0']);
      assert.ok(lstatSync(join(nm, 'electron')).isSymbolicLink() && lstatSync(join(nm, '@a', 'b')).isSymbolicLink());
      assert.deepEqual(readdirSync(join(principale, 'node_modules')).sort(), ['@a', 'electron'], 'il principale non riceve niente');
      assert.deepEqual(readdirSync(join(principale, 'node_modules', '@a')), ['b']);
    } finally {
      togliCartella(clone);
      togliCartella(principale);
    }
  });

  test('una versione diversa, o una voce dentro un pacchetto che c\'è già, non si cambia: si dice', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.6.0', 'node_modules/hash-wasm': '4.12.0', 'node_modules/a': '1.0.0' });
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    try {
      mkdirSync(wt, { recursive: true });
      lockCon(wt, { ...LOCK_FILO, 'node_modules/a': { version: '1.0.0' }, 'node_modules/a/node_modules/b': { version: '2.0.0' } });
      const f = npmFinto();
      const righe = [];
      const r = allineaPerLeProve(wt, { ...conNpm(f, dir), log: (s) => righe.push(s) });
      assert.equal(r.esito, 'non riuscita');
      assert.deepEqual(r.mancanti.map((v) => [v.percorso, v.trovata]), [['node_modules/electron', '44.6.0'], ['node_modules/a/node_modules/b', null]]);
      assert.deepEqual(f.chiamate, [], 'niente da aggiungere: npm non parte');
      assert.equal(versioneIn(dir, 'node_modules/electron'), '44.6.0', 'un Electron forse acceso non si sostituisce');
      assert.equal(existsSync(join(dir, 'node_modules', 'a', 'node_modules')), false, 'il pacchetto a della principale resta com\'era');
      assert.match(righe.join('\n'), /electron 44\.7\.0 \(c'è 44\.6\.0\).*si aggiunge soltanto/);
    } finally { togliCartella(dir); }
  });

  test('mai attraverso un collegamento: un ambito collegato tutto intero non riceve pacchetti', () => {
    const principale = progetto({}, { 'node_modules/@a/b': '1.0.0' });
    const clone = cartellaTemporanea('filo-clone-');
    try {
      const nm = join(clone, 'node_modules');
      mkdirSync(nm);
      symlinkSync(join(principale, 'node_modules', '@a'), join(nm, '@a'), 'junction');
      writeFileSync(join(nm, MARCA_COLLEGATI), 'x\n');
      lockCon(clone, { 'node_modules/@a/b': { version: '1.0.0' }, 'node_modules/@a/nuovo': { version: '1.0.0' } });
      const r = allineaPerLeProve(clone, conNpm(npmFinto(), clone));
      assert.equal(r.esito, 'non riuscita');
      assert.deepEqual(r.mancanti.map((v) => v.nome), ['@a/nuovo']);
      assert.deepEqual(readdirSync(join(principale, 'node_modules', '@a')), ['b'], 'niente scritto nella cartella a cui porta');
      assert.deepEqual(appoggiRimasti(nm), []);
    } finally {
      togliCartella(clone);
      togliCartella(principale);
    }
  });

  test('npm che fallisce: lo dice, le prove partono, niente appoggio né blocco rimasti; un appoggio di una corsa morta si toglie', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    try {
      mkdirSync(wt, { recursive: true });
      lockCon(wt, LOCK_FILO);
      const nm = join(dir, 'node_modules');
      mkdirSync(join(nm, '.filo-complemento-morto', 'node_modules'), { recursive: true });
      const righe = [];
      const rotto = npmFinto({ codice: 1 });
      const r = allineaPerLeProve(wt, { ...conNpm(rotto, dir), log: (s) => righe.push(s) });
      assert.equal(r.esito, 'non riuscita');
      assert.deepEqual(r.mancanti.map((v) => v.nome), ['hash-wasm']);
      assert.match(righe.join('\n'), /npm è uscito con 1\), mancano ancora: hash-wasm 4\.12\.0\. Le prove partono lo stesso/);
      assert.deepEqual(appoggiRimasti(nm), []);
      assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.lock')), [], 'il blocco se ne va');
      assert.equal(allineaPerLeProve(wt, conNpm(npmFinto(), dir)).esito, 'installati', 'al giro dopo si riprova');
    } finally { togliCartella(dir); }
  });

  test('mentre la principale installa per sé (il pre-avvio), l\'albero aspetta il suo turno invece di installare insieme', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    try {
      mkdirSync(wt, { recursive: true });
      lockCon(wt, LOCK_FILO);
      const blocco = fileBlocco(realpathSync(dir), dir);
      writeFileSync(blocco, '');
      const f = npmFinto();
      const righe = [];
      const r = completaPacchetti(wt, {
        installa: f.installa, cartellaBlocchi: dir, log: (s) => righe.push(s),
        attendi: () => { metti(dir, 'node_modules/hash-wasm', '4.12.0'); rmSync(blocco); },
      });
      assert.equal(r.esito, 'allineati', 'l\'ha già messa chi teneva il turno');
      assert.deepEqual(f.chiamate, []);
      assert.match(righe.join('\n'), /Un altro avvio sta installando/);
    } finally { togliCartella(dir); }
  });

  test('il pre-avvio lanciato da un collegamento alla principale prende lo stesso turno delle prove dell\'albero', () => {
    const dir = progetto(LOCK_FILO, { 'node_modules/electron': '44.7.0' });
    const fuori = cartellaTemporanea('filo-pacchetti-collegamento-');
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    try {
      mkdirSync(wt, { recursive: true });
      lockCon(wt, LOCK_FILO);
      const daCollegamento = join(fuori, 'principale');
      symlinkSync(dir, daCollegamento, 'junction');
      const blocco = fileBlocco(daCollegamento, dir);
      assert.equal(blocco, fileBlocco(realpathSync(dir), dir));
      writeFileSync(blocco, '');
      const f = npmFinto();
      const r = completaPacchetti(wt, {
        installa: f.installa, cartellaBlocchi: dir, log: () => {},
        attendi: () => { metti(dir, 'node_modules/hash-wasm', '4.12.0'); rmSync(blocco); },
      });
      assert.equal(r.esito, 'allineati');
      assert.deepEqual(f.chiamate, [], 'nessuna installazione insieme a quella del pre-avvio');
    } finally { togliCartella(fuori); togliCartella(dir); }
  });

  test('l\'appoggio chiede le versioni del lock, gli alias e le sorgenti locali come le scrive il lock', () => {
    const radice = resolve('/progetto');
    const lock = { packages: {
      '': { name: 'p' },
      'node_modules/nuovo': { version: '1.2.3', resolved: 'https://registry.npmjs.org/nuovo/-/nuovo-1.2.3.tgz', integrity: 'sha512-x' },
      'node_modules/nuovo/node_modules/dentro': { version: '2.0.0' },
      'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3' },
      'node_modules/@s/locale': { version: '1.0.0', resolved: 'file:pacchetti/locale-1.0.0.tgz' },
      'node_modules/presente': { version: '1.0.0' },
      'node_modules/presente/node_modules/dentro': { version: '3.0.0' },
    } };
    const assenti = ['node_modules/nuovo', 'node_modules/string-width-cjs', 'node_modules/@s/locale'].map((percorso) => ({ percorso }));
    const p = progettoDiAppoggio(lock, assenti, radice);
    assert.deepEqual(p.pacchetto.dependencies, {
      '@s/locale': `file:${resolve(radice, 'pacchetti/locale-1.0.0.tgz')}`, nuovo: '1.2.3', 'string-width-cjs': 'npm:string-width@4.2.3',
    });
    assert.deepEqual(Object.keys(p.lock.packages), ['', 'node_modules/nuovo', 'node_modules/nuovo/node_modules/dentro', 'node_modules/string-width-cjs', 'node_modules/@s/locale']);
    assert.equal(p.lock.packages['node_modules/nuovo'].integrity, 'sha512-x', 'la sorgente e l\'impronta del lock restano');
    assert.equal(p.lock.packages['node_modules/@s/locale'].resolved, `file:${resolve(radice, 'pacchetti/locale-1.0.0.tgz')}`);
    assert.equal(primoLivello('node_modules/@s/x/node_modules/y'), 'node_modules/@s/x');
    assert.equal(primoLivello('node_modules/x'), 'node_modules/x');
  });

  test('davvero, con npm: la libreria nuova arriva nella principale e niente di ciò che c\'era cambia', () => {
    const dir = cartellaTemporanea('filo-complemento-');
    const env = { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    const npm = (args, cwd) => spawnSync('npm', args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
    try {
      const fai = (nome, versione) => {
        const d = join(dir, 'sorgenti', `${nome}-${versione}`);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'package.json'), JSON.stringify({ name: nome, version: versione, main: 'index.js' }));
        writeFileSync(join(d, 'index.js'), `module.exports = '${nome}@${versione}';\n`);
        const pack = npm(['pack'], d);
        assert.equal(pack.status, 0, pack.stderr);
        return join(d, `${nome}-${versione}.tgz`);
      };
      const tgz = { a1: fai('a', '1.0.0'), a2: fai('a', '2.0.0'), nuova: fai('nuova', '1.0.0') };
      const principale = join(dir, 'principale');
      mkdirSync(principale);
      copyFileSync(tgz.a1, join(principale, 'a.tgz'));
      writeFileSync(join(principale, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { a: 'file:a.tgz' } }));
      const prima = npm(['install'], principale);
      assert.equal(prima.status, 0, prima.stderr);
      metti(principale, 'node_modules/estranea', '1.0.0'); // un pacchetto che il lock della principale non conosce

      // Il worktree: il main di adesso ha la libreria nuova e un'altra versione di a.
      const wt = join(principale, '.claude', 'worktrees', 'lavoro');
      mkdirSync(wt, { recursive: true });
      copyFileSync(tgz.a2, join(wt, 'a.tgz'));
      copyFileSync(tgz.nuova, join(wt, 'nuova.tgz'));
      writeFileSync(join(wt, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { a: 'file:a.tgz', nuova: 'file:nuova.tgz' } }));
      const lockWt = npm(['install', '--package-lock-only'], wt);
      assert.equal(lockWt.status, 0, lockWt.stderr);
      const locks = [readFileSync(join(principale, 'package-lock.json'), 'utf8'), readFileSync(join(wt, 'package-lock.json'), 'utf8')];

      const righe = [];
      const r = allineaPerLeProve(wt, { log: (s) => righe.push(s) });
      assert.equal(r.esito, 'non riuscita', righe.join('\n'));
      assert.deepEqual(r.mancanti.map((v) => [v.nome, v.trovata]), [['a', '1.0.0']], 'la versione diversa resta, detta');
      const daWt = createRequire(join(wt, 'index.js'));
      assert.equal(daWt('nuova'), 'nuova@1.0.0', 'le prove del worktree la trovano');
      assert.equal(daWt('a'), 'a@1.0.0', 'a della principale non è cambiato');
      assert.equal(versioneIn(principale, 'node_modules/estranea'), '1.0.0', 'e niente si è tolto');
      assert.deepEqual([readFileSync(join(principale, 'package-lock.json'), 'utf8'), readFileSync(join(wt, 'package-lock.json'), 'utf8')], locks);
      assert.deepEqual(appoggiRimasti(join(principale, 'node_modules')), []);
      assert.equal(existsSync(join(wt, 'node_modules')), false);
    } finally { togliCartella(dir); }
  });
});

describe('il pre-avvio', () => {
  test('npm start e npm run dev passano entrambi dal pre-avvio', () => {
    const { scripts } = json('package.json');
    assert.equal(scripts.prestart, 'node scripts/prestart.mjs');
    assert.equal(scripts.predev, 'node scripts/prestart.mjs');
  });

  test('davvero: il pacchetto tolto da node_modules torna e il lock resta com\'è; l\'avvio esce sempre 0', () => {
    const dir = cartellaTemporanea('filo-prestart-');
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    const npm = (args, cwd) => spawnSync('npm', args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
    try {
      const piccolo = join(dir, 'piccolo');
      mkdirSync(piccolo);
      writeFileSync(join(piccolo, 'package.json'), JSON.stringify({ name: 'piccolo', version: '1.0.0', main: 'index.js' }));
      writeFileSync(join(piccolo, 'index.js'), 'module.exports = 42;\n');
      const app = join(dir, 'app');
      mkdirSync(join(app, 'scripts', 'lib'), { recursive: true });
      // Nessun percorso fra gli argomenti: su Windows npm passa da cmd.exe, e la temporanea ha uno spazio nel nome.
      const pack = npm(['pack'], piccolo);
      assert.equal(pack.status, 0, pack.stderr);
      copyFileSync(join(piccolo, 'piccolo-1.0.0.tgz'), join(app, 'piccolo-1.0.0.tgz'));
      writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { piccolo: 'file:piccolo-1.0.0.tgz' } }));
      const prima = npm(['install'], app);
      assert.equal(prima.status, 0, prima.stderr);
      copyFileSync(join(ROOT, 'scripts', 'prestart.mjs'), join(app, 'scripts', 'prestart.mjs'));
      copyFileSync(join(ROOT, 'scripts', 'lib', 'pacchetti.mjs'), join(app, 'scripts', 'lib', 'pacchetti.mjs'));
      // Un repo suo: il pull del pre-avvio non deve mai arrivare al repo dentro cui gira la prova.
      assert.equal(spawnSync('git', ['init', '-q'], { cwd: app }).status, 0);
      const lock = readFileSync(join(app, 'package-lock.json'), 'utf8');
      assert.ok(togliCartella(join(app, 'node_modules', 'piccolo')));

      const r = spawnSync(process.execPath, [join(app, 'scripts', 'prestart.mjs')], { cwd: app, env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\[prestart\] Installo i pacchetti nuovi: piccolo 1\.0\.0/);
      assert.equal(JSON.parse(readFileSync(join(app, 'node_modules', 'piccolo', 'package.json'), 'utf8')).version, '1.0.0');
      assert.equal(readFileSync(join(app, 'package-lock.json'), 'utf8'), lock);

      rmSync(join(app, 'scripts', 'lib', 'pacchetti.mjs'));
      const senza = spawnSync(process.execPath, [join(app, 'scripts', 'prestart.mjs')], { cwd: app, env, encoding: 'utf8' });
      assert.equal(senza.status, 0, 'un controllo che non si carica non ferma npm start');
      assert.match(senza.stdout, /controllo dei pacchetti saltato/);
    } finally { togliCartella(dir); }
  });
});

describe('il pacchetto installato porta le librerie di src/', () => {
  // electron-builder mette nel pacchetto solo `dependencies`: una libreria che src/ richiede e che sta altrove
  // mancherebbe all'app installata, come hash-wasm mancava a chi avviava dai sorgenti.
  const NODE = new Set(builtinModules);
  // `ObjC.import('Foundation')` dello script del Mac è un metodo, non un modulo: dopo un punto non è un import.
  const RICHIESTA = /\brequire(?:\.resolve)?\(\s*['"]([^'"]+)['"]\s*[,)]|(?<!\.)\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s+['"]([^'"]+)['"]/g;

  function sorgenti(d, acc = []) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) sorgenti(p, acc);
      else if (/\.(c|m)?js$/.test(e)) acc.push(p);
    }
    return acc;
  }

  function pacchettiRichiesti() {
    const usati = new Map();
    for (const f of sorgenti(join(ROOT, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(RICHIESTA)) {
        const s = m[1] || m[2] || m[3];
        if (/^[./]|^node:|^[a-z]+:\/\//.test(s) || NODE.has(s.split('/')[0])) continue;
        const nome = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
        if (nome === 'electron') continue; // lo porta il runtime
        if (!usati.has(nome)) usati.set(nome, relative(ROOT, f).replace(/\\/g, '/'));
      }
    }
    return usati;
  }

  test('ogni libreria che src/ richiede sta in dependencies, e il lock non la segna come solo di sviluppo', () => {
    const usati = pacchettiRichiesti();
    assert.ok(usati.has('hash-wasm'), 'la scansione deve vedere almeno hash-wasm del profilo segreto');
    const { dependencies = {} } = json('package.json');
    const lock = json('package-lock.json');
    const fuori = [...usati].filter(([n]) => !dependencies[n]).map(([n, f]) => `${n} (da ${f})`);
    assert.deepEqual(fuori, [], 'richieste da src/ ma assenti da dependencies: l\'app installata non le avrebbe');
    const soloDev = [...usati.keys()].filter((n) => lock.packages[`node_modules/${n}`]?.dev);
    assert.deepEqual(soloDev, [], 'nel lock risultano di solo sviluppo');
  });
});
