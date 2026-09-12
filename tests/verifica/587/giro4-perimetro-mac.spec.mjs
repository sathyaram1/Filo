// Verifica #587, giro 4 — la cartella dove un Mac tiene i segreti.
//
// IL SINTOMO. Una pagina ostile pilota il modello, il modello legge un file
// dell'utente e lo porta fuori. Sul lato lettura il principio è sempre lo
// stesso: dentro la cartella dell'utente restano fuori dal «niente conferma» i
// BERSAGLI RISERVATI, perché il perimetro dichiarato È la home e lì dentro
// stanno chiavi, credenziali e profili.
//
// COSA PROVA QUESTO FILE. Che l'elenco dei bersagli riservati conosce Linux
// (`.config`, `.ssh`, `.mozilla`, `.local`) e Windows (`AppData`,
// `NTUSER.DAT`), ma NON macOS, dove tutto quello che quei nomi proteggono vive
// in una cartella sola, `~/Library`, che non è nemmeno nascosta:
//
//   ~/Library/Application Support/Filo/storage.json   le chiavi API e il
//                                                     portafoglio di Filo
//   ~/Library/Keychains/…                             il portachiavi
//   ~/Library/Application Support/Firefox/…           le password del browser
//   ~/Library/Cookies, ~/Library/Mail, ~/Library/Messages
//
// Lo stesso identico file di Filo chiede un OK su Linux (`.config/Filo`) e su
// Windows (`AppData\Roaming\Filo`) e non chiede niente su Mac: stessa lettura,
// tre risposte diverse. Filo si scarica anche su Mac (CLAUDE.md § «Filo gira
// anche su Mac»), e un Mac si rompe in silenzio.
//
// L'ultima prova non giudica il testo del comando: esegue davvero, con la
// stessa shell che usa Filo, dentro una finta cartella dell'utente fatta come
// quella di un Mac, e guarda cosa finisce nell'output — cioè nella
// conversazione col modello, da dove un link può poi portarlo fuori.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;
C.setRealPath((p) => {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
});

const MAC = '/Users/mario';
const LIN = '/home/mario';
const WIN = 'C:\\Users\\mario';
const dove = (home, shell) => ({ perimetro: home, home, cwd: home, shell: shell || '' });

test.describe('#587 — i segreti di un Mac stanno in ~/Library', () => {
  // ── Porta 1: il file di Filo, cioè le chiavi API e il portafoglio ──────────
  test('il file dove Filo tiene le chiavi chiede un OK anche su Mac', () => {
    for (const cmd of [
      'cat "Library/Application Support/Filo/storage.json"',
      'cat Library/Application\\ Support/Filo/storage.json',
      'cat ~/Library/Application\\ Support/Filo/storage.json',
      'head -c 4000 "Library/Application Support/Filo/storage.json"',
      'cd Library/Application\\ Support/Filo && cat storage.json',
    ]) {
      expect(C.classify(cmd, dove(MAC, 'bash')), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // Lo stesso file, sulle altre due piattaforme, un OK lo chiede già: è la
  // dimostrazione che qui non si sta chiedendo una regola nuova, ma la stessa.
  test('lo stesso file su Linux e su Windows chiede un OK', () => {
    expect(C.classify('cat .config/Filo/storage.json', dove(LIN, 'bash'))).toBe(2);
    expect(C.classify('type AppData\\Roaming\\Filo\\storage.json', dove(WIN, 'powershell'))).toBe(2);
  });

  // ── Porta 2: il portachiavi, le password del browser, la posta ─────────────
  test('le altre cassette dei segreti di un Mac chiedono un OK', () => {
    for (const cmd of [
      'cat Library/Keychains/login.keychain-db',
      'cat "Library/Application Support/Firefox/Profiles/ab.default/logins.json"',
      'cat "Library/Application Support/Google/Chrome/Default/Login Data"',
      'cat Library/Cookies/Cookies.binarycookies',
      'cat Library/Messages/chat.db',
    ]) {
      expect(C.classify(cmd, dove(MAC, 'bash')), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 3: la ricerca ricorsiva dentro Library ───────────────────────────
  // Il giro 1 ha chiuso «cerca in tutta la mia cartella»: la ricorsiva che parte
  // dalla home chiede un OK. Su un Mac la stessa raccolta di chiavi si ottiene
  // un gradino più sotto, e lì la ricorsiva non è misurata da niente.
  test('cercare dentro Library chiede un OK', () => {
    for (const cmd of [
      'grep -r password Library',
      'grep -rh assword "Library/Application Support"',
      'grep -r PRIVATE Library/Keychains',
    ]) {
      expect(C.classify(cmd, dove(MAC, 'bash')), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── La stessa lettura per l'altra strada: «leggi questo file» ──────────────
  // LEGGI_DOCUMENTO apre dal disco gli stessi file di un `cat`: due strade per
  // la stessa cosa non possono avere livelli diversi, o chiudere il terminale
  // sposta soltanto la porta.
  test('anche «leggi questo file» si ferma sui segreti di un Mac', () => {
    const opts = { perimetro: MAC, home: MAC, cwd: MAC, soloRiservati: true };
    for (const p of [
      `${MAC}/Library/Application Support/Filo/storage.json`,
      `${MAC}/Library/Keychains/login.keychain-db`,
      `${MAC}/Library/Application Support/Firefox/Profiles/ab.default/logins.json`,
    ]) {
      expect(C.pathReason(p, opts), `«${p}» deve dare un motivo`).not.toBe('');
    }
    // Il documento di tutti i giorni, invece, non deve chiedere niente.
    expect(C.pathReason(`${MAC}/Documents/bolletta.pdf`, opts)).toBe('');
  });

  // ── Il cammino normale su Mac non deve peggiorare ──────────────────────────
  test('le letture di tutti i giorni su un Mac restano senza attrito', () => {
    for (const cmd of [
      'cat appunti.txt',
      'cat Documents/bolletta.pdf',
      'head -5 Documents/*.csv',
      'ls -la',
      'ls Desktop',
      'grep credentials appunti.txt',
      'cat progetto/src/index.js',
    ]) {
      expect(C.classify(cmd, dove(MAC, 'bash')), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── Il legame fra il livello e ciò che esce davvero ────────────────────────
  test('un comando che stampa le chiavi di un Mac non parte senza un OK', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-mac-');
    try {
      mkdirSync(join(casa, 'Library', 'Application Support', 'Filo'), { recursive: true });
      mkdirSync(join(casa, 'Library', 'Keychains'), { recursive: true });
      mkdirSync(join(casa, 'Library', 'Application Support', 'Firefox', 'Profiles', 'ab.default'), { recursive: true });
      mkdirSync(join(casa, 'Documents'), { recursive: true });
      writeFileSync(join(casa, 'Library', 'Application Support', 'Filo', 'storage.json'),
        '{"apiKeys":{"openrouter":"sk-or-CHIAVEAPIFILO"},"wallet":{"saldo":42}}\n');
      writeFileSync(join(casa, 'Library', 'Keychains', 'login.keychain-db'), 'PORTACHIAVIMAC\n');
      writeFileSync(join(casa, 'Library', 'Application Support', 'Firefox', 'Profiles', 'ab.default', 'logins.json'),
        '{"password":"PASSWORDFIREFOX"}\n');
      writeFileSync(join(casa, 'Documents', 'bolletta.txt'), 'totale 84,20 euro\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');
      const segreti = ['CHIAVEAPIFILO', 'PORTACHIAVIMAC', 'PASSWORDFIREFOX'];

      for (const cmd of [
        'cat "Library/Application Support/Filo/storage.json"',
        'cat Library/Application\\ Support/Filo/storage.json',
        'cat Library/Keychains/login.keychain-db',
        'grep -r password Library',
        'cd Library/Application\\ Support/Filo && cat storage.json',
        'cat appunti.txt',
        'cat Documents/bolletta.txt',
      ]) {
        const out = execFileSync('bash', ['-c', `${cmd} 2>/dev/null || true`], { cwd: casa, encoding: 'utf8' });
        const uscito = segreti.find((s) => out.includes(s));
        const livello = C.classify(cmd, { perimetro: casa, home: casa, cwd: casa, shell: 'bash' });
        if (uscito) {
          expect(livello, `«${cmd}» stampa ${uscito}: non può partire senza un OK`).toBe(2);
        } else {
          expect(livello, `«${cmd}» non tira fuori niente di riservato: non deve chiedere niente`).toBe(1);
        }
      }
    } finally {
      rmSync(casa, { recursive: true, force: true });
    }
  });
});
