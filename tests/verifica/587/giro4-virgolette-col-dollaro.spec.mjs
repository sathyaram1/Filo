// Verifica #587, giro 4 — quello che bash SCIOGLIE dentro `$'…'`.
//
// IL SINTOMO, e la causa già trovata tre volte: «il bersaglio è quello che il
// comando APRIRÀ, non quello che c'è scritto». Al giro 1 a nascondere il
// bersaglio era uno spostamento di cartella o una ricerca ricorsiva; al giro 2
// un carattere jolly; al giro 3 la barra rovesciata come escape e le virgolette
// col dollaro davanti (`$'.ssh/config'`).
//
// COSA PROVA QUESTO FILE. Che di `$'…'` è stata tolta la buccia — le virgolette
// — ma non è stato letto il contenuto. Dentro `$'…'` bash NON si limita a
// togliere le barre rovesciate: scioglie le sequenze di escape, cioè `\xNN`
// (esadecimale), `\NNN` (ottale) e `\uNNNN`. Così un nome riservato si riscrive
// carattere per carattere:
//
//   cat $'.ss\x68/config'              apre ~/.ssh/config
//   cat $'.ss\150/config'              apre ~/.ssh/config
//   cat $'.ssh/config'            apre ~/.ssh/config
//   cat $'.netr\x63'                   apre ~/.netrc
//   cat $'.confi\x67/Filo/storage.json'  apre il file dove Filo tiene le chiavi
//
// Il controllo legge `.ssx68`, `.ss150`, `.netrx63`: nomi che non somigliano a
// niente di riservato, dentro la cartella dell'utente, quindi livello 1.
//
// L'ultima prova non giudica il testo del comando: esegue davvero, con la stessa
// shell che usa Filo, dentro una finta cartella dell'utente, e guarda cosa
// finisce nell'output.

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
const dove = () => ({ perimetro: HOME, home: HOME, cwd: HOME, shell: 'bash' });

test.describe('#587 — le sequenze di escape dentro $\'…\'', () => {
  // ── Porta 1: l'esadecimale ─────────────────────────────────────────────────
  test('un nome riservato riscritto in esadecimale chiede un OK', () => {
    for (const cmd of [
      "cat $'.ss\\x68/config'",
      "cat $'.ss\\x68/id_rsa'",
      "cat $'.netr\\x63'",
      "cat $'.pgpas\\x73'",
      "cat $'.git-credential\\x73'",
      "cat $'.confi\\x67/Filo/storage.json'",
      "grep -h . $'.ss\\x68/config'",
      "head -1 $'.ss\\x68/id_rsa'",
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 2: l'ottale e l'unicode ──────────────────────────────────────────
  test('le altre due forme di escape non nascondono il bersaglio', () => {
    for (const cmd of [
      "cat $'.ss\\150/config'",
      "cat $'.ss\\u0068/config'",
      "cat $'.netr\\143'",
      "cat $'.confi\\147/Filo/storage.json'",
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» deve chiedere un OK`).toBe(2);
    }
  });

  // ── Porta 3: lo spostamento scritto così ───────────────────────────────────
  // Il giro 1 ha chiuso «vai in .ssh e mostrami config»; il giro 3 lo ha chiuso
  // scritto con la barra rovesciata. Scritto in esadecimale torna gratis.
  test('spostarsi in una cartella riscritta in esadecimale e poi leggere chiede un OK', () => {
    expect(C.classify("cd $'.ss\\x68' && cat config", dove())).toBe(2);
    expect(C.classify("cd $'.ss\\x68' ; cat id_rsa", dove())).toBe(2);
    expect(C.classify("ls $'.ss\\x68'", dove())).toBe(2);
    expect(C.classify("grep -r PRIVATE $'.ss\\x68'", dove())).toBe(2);
  });

  // ── Il cammino normale non deve peggiorare ─────────────────────────────────
  test('le letture di tutti i giorni continuano a non chiedere niente', () => {
    for (const cmd of [
      'cat appunti.txt',
      "cat $'appunti.txt'",
      "cat $'Documenti/nota di spesa.txt'",
      'head -5 Documenti/*.csv',
      'ls -la',
      'grep credentials appunti.txt',
    ]) {
      expect(C.classify(cmd, dove()), `«${cmd}» non deve chiedere niente`).toBe(1);
    }
  });

  // ── Il legame fra il livello e ciò che esce davvero ────────────────────────
  test('un comando che stampa chiavi e password non parte senza un OK', () => {
    test.skip(process.platform === 'win32', 'la prova usa bash; su Windows la shell è PowerShell');
    const casa = cartellaTemporanea('587-dollaro-');
    try {
      mkdirSync(join(casa, '.ssh'), { recursive: true });
      mkdirSync(join(casa, '.config', 'Filo'), { recursive: true });
      writeFileSync(join(casa, '.ssh', 'config'), 'Host lavoro\nPASSWORDSSHCONFIG\n');
      writeFileSync(join(casa, '.ssh', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nCHIAVEPRIVATAFINTA\n');
      writeFileSync(join(casa, '.config', 'Filo', 'storage.json'), '{"apiKeys":{"openrouter":"sk-or-CHIAVEAPIFILO"}}\n');
      writeFileSync(join(casa, '.netrc'), 'machine ftp.esempio.it login mario password SEGRETONETRC\n');
      writeFileSync(join(casa, 'appunti.txt'), 'la lista della spesa\n');
      const segreti = ['PASSWORDSSHCONFIG', 'CHIAVEPRIVATAFINTA', 'CHIAVEAPIFILO', 'SEGRETONETRC'];

      for (const cmd of [
        "cat $'.ss\\x68/config'",
        "cat $'.ss\\150/config'",
        "cat $'.ss\\u0068/id_rsa'",
        "cat $'.netr\\x63'",
        "cat $'.confi\\x67/Filo/storage.json'",
        "cd $'.ss\\x68' && cat config",
        'cat appunti.txt',
        "cat $'appunti.txt'",
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
