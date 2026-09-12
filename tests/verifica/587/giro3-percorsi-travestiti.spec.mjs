// Verifica #587, giro 3 — il bersaglio scritto in un'altra forma.
//
// IL SINTOMO. Una pagina ostile pilota il modello, il modello legge un file
// dell'utente e lo porta fuori. Sul lato lettura il principio che chiude le
// porte è sempre lo stesso, ed è scritto nel lavoro: «il bersaglio è quello che
// il comando APRIRÀ, non quello che c'è scritto». Il giro 1 l'ha applicato allo
// spostamento di cartella, alla lettura ricorsiva e al comando senza percorso;
// il giro 2 ai caratteri jolly e ai collegamenti.
//
// COSA PROVA QUESTO FILE. Che lo stesso principio non regge quando il percorso
// è scritto in una forma che la SHELL scioglie e il controllo no:
//
//   • la barra rovesciata come ESCAPE. Fuori da Windows la shell di Filo è
//     bash (src/main/services/terminal.js), e lì `\` non separa le cartelle:
//     annulla il carattere dopo. `cat .ss\h/config` apre `~/.ssh/config`,
//     `cat .netr\c` apre `~/.netrc`. Il controllo legge invece la barra
//     rovesciata come un separatore (la convenzione di Windows) e vede due
//     segmenti innocui, `.ss` e `h`;
//   • le virgolette con il dollaro davanti (`$'…'`), che in bash sono solo un
//     altro modo di scrivere la stessa stringa: `cat $'.ssh/config'` apre lo
//     stesso file, e il controllo vede un segmento `$.ssh` che non somiglia a
//     niente di riservato;
//   • su Windows, il parametro con i due punti: `Get-Content -Path:.ssh\config`
//     è la stessa lettura di `Get-Content .ssh\config`, ma il percorso viaggia
//     attaccato al nome del parametro e il controllo lo scarta come se fosse
//     una semplice opzione.
//
// L'ultima prova non giudica il testo del comando: esegue davvero, con la
// stessa shell che usa Filo, dentro una finta cartella dell'utente, e guarda
// cosa finisce nell'output — cioè nella conversazione col modello, da dove un
// link può poi portarlo fuori. La regola che deve valere è una sola: se
// dall'output escono chiavi o password, quel comando non poteva partire senza
// un OK.

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
// Nel processo principale il classificatore sa chiedere il percorso vero su
// disco (src/main/services/loader.js): qui gli diamo lo stesso gancio, così la
// prova non è più severa di Filo vero.
C.setRealPath((p) => {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
});

const HOME = '/home/mario';
const WIN = 'C:\\Users\\mario';
const dove = (cwd = HOME, home = HOME) => ({ perimetro: home, home, cwd });

test.describe('#587 — un percorso scritto in un’altra forma', () => {
  // ── Porta 1: la barra rovesciata come escape ───────────────────────────────
  test('una cartella riservata con una barra rovesciata in mezzo chiede un OK', () => {
    for (const cmd of [
      'cat .ss\\h/config',
      'cat .\\ssh/config',
      'cat .ss\\h/known_hosts',
      'head -5 .ss\\h/*',
      'grep -h . .ss\\h/config',
      'cat .gnup\\g/secring.gpg',
      'cat .confi\\g/Filo/storage.json',
      'wc -c .confi\\g/Filo/storage.json',
      'cat ~/.ss\\h/config',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 2: lo stesso trucco sul NOME del file ────────────────────────────
  test('un file riservato con una barra rovesciata in mezzo chiede un OK', () => {
    for (const cmd of [
      'cat .netr\\c',
      'cat .git-credential\\s',
      'cat .pgpas\\s',
      'cat .bash_histor\\y',
      'cat .env\\rc',
      'head -1 .npmr\\c',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 3: le virgolette col dollaro davanti ─────────────────────────────
  test('le virgolette in stile bash non nascondono il bersaglio', () => {
    for (const cmd of [
      "cat $'.ssh/config'",
      "cat $'.ssh/id_rsa'",
      "cat $'.netrc'",
      "cat $'.config/Filo/storage.json'",
      "cd $'.ssh' && cat config",
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 4: lo spostamento scritto nella forma travestita ─────────────────
  // Il giro 1 ha chiuso «vai in .ssh e mostrami config». Con la barra rovesciata
  // lo spostamento torna invisibile, anche fatto in un turno precedente.
  test('spostarsi in una cartella travestita e poi leggere chiede un OK', () => {
    expect(C.classify('cd .ss\\h && cat config', dove())).toBe(2);
    expect(C.classify('cd .ss\\h ; cat known_hosts', dove())).toBe(2);
    expect(C.classify('ls .ss\\h', dove())).toBe(2);
    expect(C.classify('grep -r PRIVATE .ss\\h', dove())).toBe(2);
    expect(
      C.classify('cat config', dove('/home/mario/.ss\\h')),
      'spostamento del turno prima',
    ).toBe(2);
  });

  // ── Porta 5: su Windows, il percorso attaccato al nome del parametro ───────
  // `-Path:<percorso>` è la stessa lettura di `-Path <percorso>`: PowerShell
  // lega i parametri anche con i due punti. Giudicata sul classificatore, non
  // su una macchina Windows vera.
  test('il percorso attaccato al parametro viene misurato', () => {
    for (const cmd of [
      'Get-Content -Path:.ssh\\config',
      'Get-Content -LiteralPath:.ssh\\id_rsa',
      'Select-String -Path:.ssh\\* PRIVATE',
      'gc -Path:AppData\\Roaming\\Filo\\storage.json',
    ]) {
      expect(C.classify(cmd, dove(WIN, WIN)), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Il cammino normale non deve peggiorare ─────────────────────────────────
  test('le letture di tutti i giorni continuano a non chiedere niente', () => {
    for (const cmd of [
      'cat appunti.txt',
      'cat *.txt',
      'head -5 Documenti/*.csv',
      'ls -la',
      'grep credentials appunti.txt',
      'cat progetto/src/index.js',
      'wc -l Documenti/bilancio.csv',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── Il legame fra il livello e ciò che esce davvero ────────────────────────
  test('un comando che stampa chiavi e password non parte senza un OK', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-travestiti-');
    try {
      mkdirSync(join(casa, '.ssh'), { recursive: true });
      mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
      writeFileSync(join(casa, '.ssh', 'config'), 'Host lavoro\n  IdentityFile ~/.ssh/id_rsa\nPASSWORDSSHCONFIG\n');
      writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nCHIAVEPRIVATAFINTA\n');
      writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"sk-or-CHIAVEAPIFILO"}}\n');
      writeFileSync(join(casa, '.netrc'), 'machine ftp.esempio.it login mario password SEGRETONETRC\n');
      writeFileSync(join(casa, '.git-credentials'), 'https://mario:TOKENGITHUB@github.com\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');
      const segreti = ['PASSWORDSSHCONFIG', 'CHIAVEPRIVATAFINTA', 'CHIAVEAPIFILO', 'SEGRETONETRC', 'TOKENGITHUB'];

      for (const cmd of [
        'cat .ss\\h/config',
        'cat .ss\\h/*',
        'cat .netr\\c',
        'cat .git-credential\\s',
        'cat .confi\\g/Filo/storage.json',
        "cat $'.ssh/config'",
        "cat $'.netrc'",
        'cat appunti.txt',
        'cat *.txt',
      ]) {
        const out = execFileSync('bash', ['-c', `${cmd} 2>/dev/null || true`], { cwd: casa, encoding: 'utf8' });
        const uscito = segreti.find((s) => out.includes(s));
        const livello = C.classify(cmd, { perimetro: casa, home: casa, cwd: casa });
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
