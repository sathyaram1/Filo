// Verifica #587, giro 5 — i programmi che leggono per mestiere e non vengono misurati.
//
// IL SINTOMO. Il freno sulla lettura misura il BERSAGLIO di una manciata di
// programmi noti (`cat`, `head`, `grep`, `ls`, `Get-Content`…). Un programma
// che apre file ma non sta in quell'elenco non viene misurato affatto: il suo
// livello lo decide solo il sotto-comando, e per i sotto-comandi «di lettura»
// quel livello è 1, nessuna conferma, qualunque sia il file che apre.
//
// COSA PROVA QUESTO FILE. Che `git` e `pip` sono due di quei programmi, e che
// da lì chiavi e password escono senza un clic:
//
//   git diff --no-index /dev/null ~/.ssh/id_rsa   stampa la chiave privata
//   git diff --no-index <vuota> ~/.ssh            stampa TUTTA la cartella
//   git grep --no-index -e PRIVATE                cerca in tutta la home
//   pip config list                               stampa l'indirizzo del
//                                                 repository con dentro utente
//                                                 e password
//
// Le stesse identiche letture scritte con `cat` o `grep -r` chiedono un OK.
//
// L'ultima prova non giudica il testo del comando: esegue davvero, dentro una
// finta cartella dell'utente, e guarda se dall'output esce un segreto.

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

const HOME = '/home/mario';
const dove = (cwd) => ({ perimetro: HOME, home: HOME, cwd: cwd || HOME, shell: 'bash' });

test.describe('#587 — i programmi che leggono e non vengono misurati', () => {
  // ── Porta 1: il confronto fuori da un archivio ────────────────────────────
  test('confrontare un file riservato con il vuoto chiede un OK', () => {
    for (const cmd of [
      'git diff --no-index /dev/null /home/mario/.ssh/id_rsa',
      'git diff --no-index /dev/null ~/.ssh/id_rsa',
      'git diff --no-index /dev/null .ssh/config',
      'git diff --no-index /dev/null .netrc',
      'git diff --no-index /dev/null .config/Filo/storage.json',
      'git diff --no-index /dev/null /etc/passwd',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» apre un file riservato: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 2: il confronto su una CARTELLA intera ──────────────────────────
  test('confrontare una cartella riservata con una vuota chiede un OK', () => {
    for (const cmd of [
      'git diff --no-index /tmp/vuota /home/mario/.ssh',
      'git diff --no-index /tmp/vuota ~/.aws',
      'git diff --no-index /tmp/vuota .config/Filo',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» svuota una cartella riservata nella chat: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 3: la ricerca ricorsiva dalla cartella dell'utente ──────────────
  // È il rilievo grave del giro 1, riaperto da un altro programma.
  test('la ricerca ricorsiva dalla cartella dell’utente chiede un OK anche con git', () => {
    for (const cmd of [
      'git grep --no-index -e PRIVATE',
      'git grep --no-index -e AWS_SECRET',
      'git grep --no-index --untracked -e password',
      'cd .. && git grep --no-index -e KEY',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» passa in rassegna tutta la cartella: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 4: il programma che stampa la propria configurazione ────────────
  test('stampare la configurazione di pip, che contiene utente e password, chiede un OK', () => {
    for (const cmd of ['pip config list', 'pip3 config list', 'pip config debug']) {
      expect(C.classify(cmd, dove()), `«${cmd}» stampa l’indirizzo del repository con dentro la password: deve chiedere un OK`).toBeGreaterThan(1);
    }
    // La stessa identica lettura scritta col nome del file chiede già un OK:
    // due strade per lo stesso contenuto non possono avere risposte diverse.
    expect(C.classify('cat .config/pip/pip.conf', dove())).toBeGreaterThan(1);
  });

  // ── Quello che NON va chiuso a forza di conferme ──────────────────────────
  test('l’uso di tutti i giorni di git non chiede niente', () => {
    for (const cmd of [
      'git status',
      'git log --oneline',
      'git log -p',
      'git diff',
      'git diff --stat',
      'git diff HEAD~1',
      'git show HEAD',
      'git branch',
      'git blame src/main.js',
      'cat appunti.txt',
      'head -5 Documenti/spese.csv',
      'grep ciao appunti.txt',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» è lavoro di tutti i giorni: non deve chiedere niente`).toBe(1);
    }
  });

  // ── Il legame fra il livello e ciò che esce davvero ───────────────────────
  test('un comando che stampa chiavi e password non parte senza un OK', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash e git; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-nonmisurate-');
    try {
      mkdirSync(join(casa, '.ssh'), { recursive: true });
      mkdirSync(join(casa, '.aws'), { recursive: true });
      mkdirSync(join(casa, 'vuota'), { recursive: true });
      mkdirSync(join(casa, 'Documenti'), { recursive: true });
      writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nCHIAVEPRIVATAFINTA\n');
      writeFileSync(join(casa, '.ssh', 'config'), 'Host lavoro\nPASSWORDSSHCONFIG\n');
      writeFileSync(join(casa, '.aws', 'credentials'), '[default]\naws_access_key_id = CHIAVEAWSFINTA\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');
      writeFileSync(join(casa, 'Documenti', 'spese.csv'), 'voce,euro\npane,2\n');
      const segreti = ['CHIAVEPRIVATAFINTA', 'PASSWORDSSHCONFIG', 'CHIAVEAWSFINTA'];

      for (const cmd of [
        'git diff --no-index /dev/null .ssh/id_rsa',
        'git diff --no-index vuota .ssh',
        'git diff --no-index vuota .aws',
        'git grep --no-index -e PRIVATE',
        'git grep --no-index -e CHIAVEAWS',
        'cat appunti.txt',
        'head -2 Documenti/spese.csv',
        'git diff --no-index vuota Documenti',
      ]) {
        const out = execFileSync('bash', ['-c', `${cmd} 2>/dev/null || true`], { cwd: casa, encoding: 'utf8' });
        const uscito = segreti.find((s) => out.includes(s));
        const livello = C.classify(cmd, { perimetro: casa, home: casa, cwd: casa, shell: 'bash' });
        if (uscito) {
          expect(livello, `«${cmd}» stampa ${uscito}: non può partire senza un OK`).toBeGreaterThan(1);
        } else {
          expect(livello, `«${cmd}» non tira fuori niente di riservato: non deve chiedere niente`).toBe(1);
        }
      }
    } finally {
      rmSync(casa, { recursive: true, force: true });
    }
  });
});
