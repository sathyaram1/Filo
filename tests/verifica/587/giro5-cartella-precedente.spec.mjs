// Verifica #587, giro 5 — la cartella di prima, scritta con due caratteri.
//
// IL SINTOMO, la stessa causa dei giri 1, 2, 3 e 4: «il bersaglio misurato non
// è quello che il comando aprirà davvero». Lì a nascondere il bersaglio era uno
// spostamento di cartella, una ricerca ricorsiva, un asterisco, una barra
// rovesciata, una sequenza di escape in esadecimale. Qui è `~-`, che in bash è
// la CARTELLA DI PRIMA (la stessa cosa di `$OLDPWD`, che invece viene già
// fermato), e `~1`, che è la cartella messa da parte con `pushd`.
//
// Spostarsi non chiede niente e non lascia traccia nel comando dopo. Così:
//
//   cd .ssh        (gratis)
//   cd ~           (gratis)
//   cat ~-/config  bash apre ~/.ssh/config — il controllo vede una cartella
//                  che si chiama «~-» dentro la cartella dell'utente
//
// Il caso peggiore è `cat ~-/Filo/storage.json` dopo essere passati da
// `.config`: è il file dove Filo tiene le chiavi API e il portafoglio.
//
// L'ultima prova non giudica il testo del comando: esegue davvero, con la
// stessa shell che usa Filo, dentro una finta cartella dell'utente.

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

test.describe('#587 — la cartella di prima (`~-`, `~1`)', () => {
  // ── Porta 1: la cartella di prima ─────────────────────────────────────────
  test('leggere dentro la cartella di prima chiede un OK', () => {
    for (const cmd of [
      'cat ~-/config',
      'cat ~-/id_ed25519',
      'head -20 ~-/Filo/storage.json',
      'grep -h . ~-/config',
      'wc -l ~-/config',
      'ls ~-',
      'ls -la ~-',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» può aprire una cartella riservata: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 2: la cartella messa da parte con pushd ─────────────────────────
  test('leggere dentro la cartella messa da parte chiede un OK', () => {
    for (const cmd of ['cat ~1/config', 'cat ~+1/config', 'cat ~-1/config', 'ls ~0']) {
      expect(C.classify(cmd, dove()), `«${cmd}» può aprire una cartella riservata: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Porta 3: tutto dentro la stessa sequenza ──────────────────────────────
  test('lo spostamento e la lettura nello stesso comando chiedono un OK', () => {
    for (const cmd of [
      'cd .ssh && cd ~ && cat ~-/config',
      'cd .config; cd ~; cat ~-/Filo/storage.json',
      'pushd .ssh && cd ~ && cat ~1/config',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» apre una cartella riservata: deve chiedere un OK`).toBeGreaterThan(1);
    }
  });

  // ── Quello che NON va chiuso a forza di conferme ──────────────────────────
  test('le letture di tutti i giorni continuano a non chiedere niente', () => {
    for (const cmd of [
      'cat appunti.txt',
      'head -5 Documenti/spese.csv',
      'ls',
      'ls Documenti',
      'cat ~/appunti.txt',
      'grep spesa appunti.txt',
      'cat *.txt',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── Il legame fra il livello e ciò che esce davvero ───────────────────────
  test('un comando che stampa chiavi e password non parte senza un OK', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-precedente-');
    try {
      mkdirSync(join(casa, '.ssh'), { recursive: true });
      mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
      mkdirSync(join(casa, 'Documenti'), { recursive: true });
      writeFileSync(join(casa, '.ssh', 'config'), 'Host lavoro\nPASSWORDSSHCONFIG\n');
      writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"sk-or-CHIAVEAPIFILO"}}\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');
      writeFileSync(join(casa, 'Documenti', 'spese.csv'), 'voce,euro\npane,2\n');
      const segreti = ['PASSWORDSSHCONFIG', 'CHIAVEAPIFILO'];

      for (const cmd of [
        'cd .ssh; cd ~; cat ~-/config',
        'cd .config; cd ~; cat ~-/Filo/storage.json',
        'pushd .ssh >/dev/null; pushd ~ >/dev/null; cat ~1/config',
        'cat appunti.txt',
        'head -2 Documenti/spese.csv',
      ]) {
        const out = execFileSync('bash', ['-c', `${cmd} 2>/dev/null || true`], { cwd: casa, encoding: 'utf8' });
        const uscito = segreti.find((s) => out.includes(s));
        // Il comando intero come lo vede il gate: lo spostamento è già avvenuto
        // nei turni prima, quindi si misura anche la sola lettura finale.
        const soloLettura = cmd.split(/\s*;\s*|\s*&&\s*/).pop();
        const livello = Math.max(
          C.classify(cmd, { perimetro: casa, home: casa, cwd: casa, shell: 'bash' }),
          C.classify(soloLettura, { perimetro: casa, home: casa, cwd: casa, shell: 'bash' }),
        );
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
