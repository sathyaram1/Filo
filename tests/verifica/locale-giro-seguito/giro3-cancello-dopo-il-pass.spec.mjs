// Prove del giro 3 (verifica locale) sul lavoro «seguito del giro», lato server:
// dopo il pass il cancello di fusione ammette solo prove del giro tolte, su una
// punta che discende dal commit verificato. Codice del server accanto, GitHub finto.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

/** La cartella `functions` del server con la prova di discendenza, o ''. */
function functionsServer() {
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    let voci = [];
    try { voci = readdirSync(dir).filter((n) => n.startsWith('filo-security')); } catch (_) { voci = []; }
    for (const n of voci) {
      const gate = join(dir, n, 'functions', 'src', 'routine', 'mergeGate.js');
      if (existsSync(gate) && readFileSync(gate, 'utf8').includes('isAncestor')) return join(dir, n, 'functions');
    }
    dir = dirname(dir);
  }
  return '';
}
const FN = functionsServer();

const V = 'a'.repeat(40);
const H = 'b'.repeat(40);

/** Il cancello vero dopo un pass dato a V, con la punta del ramo su H. */
async function cancello(diff, { ancestor = true } = {}) {
  const mg = require(join(FN, 'src', 'routine', 'mergeGate'));
  const scritto = [];
  const r = await mg.runMergeGate({
    ticket: { role: 'secaudit', branch: 'worker/x', feedbackId: 'f1', num: '#42' },
    readState: async () => ({ verifierVerdict: 'pass', secauditVerdict: 'pass', branch: 'worker/x', verifiedSha: V }),
    writeState: async (id, patch) => { scritto.push(patch); },
    github: {
      branchHead: async () => ({ ok: true, sha: H }),
      isAncestor: async (base, sha) => ({ ok: true, ancestor: ancestor && base === V && sha === H }),
      compareDiff: async (sha, opts) => (opts && opts.base ? { ok: true, diff } : { ok: true, diff: 'diff --git a/x b/x\n' }),
      mergeSha: async () => ({ ok: true, sha: 'c'.repeat(40) }),
    },
    gates: () => ({ passed: true, trips: [] }),
  });
  return { r, scritto };
}

const TOLTO_UN_CASO = [
  'diff --git a/tests/verifica/12/giro1.spec.mjs b/tests/verifica/12/giro1.spec.mjs',
  'index fde3ce3..9b27970 100644',
  '--- a/tests/verifica/12/giro1.spec.mjs',
  '+++ b/tests/verifica/12/giro1.spec.mjs',
  '@@ -1,6 +1,3 @@',
  " test('caso uno', async () => {",
  '   expect(1).toBe(1);',
  ' });',
  "-test('caso due', async () => {",
  '-  expect(2).toBe(3);',
  '-});',
  '',
].join('\n');

const TOLTA_UNA_PROVA = [
  'diff --git a/tests/verifica/12/giro1.spec.mjs b/tests/verifica/12/giro1.spec.mjs',
  'deleted file mode 100644',
  'index fde3ce3..0000000',
  '--- a/tests/verifica/12/giro1.spec.mjs',
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  "-test('caso uno', async () => {",
  '-  expect(1).toBe(1);',
  '-});',
  '',
].join('\n');

test.describe('cancello di fusione dopo il pass: solo prove del giro tolte, su una punta figlia del verificato', () => {
  test.skip(!FN, 'repo del server con la prova di discendenza non trovato accanto');

  test('una prova del giro tolta per intero, o un suo caso, dopo il pass si fonde', async () => {
    expect((await cancello(TOLTA_UNA_PROVA)).r.ok).toBe(true);
    expect((await cancello(TOLTO_UN_CASO)).r.ok).toBe(true);
  });

  test('la stessa prova tolta su una punta che non discende dal verificato non si fonde, e il pass si azzera', async () => {
    const { r, scritto } = await cancello(TOLTA_UNA_PROVA, { ancestor: false });
    expect(r.ok).toBe(false);
    expect(scritto.length).toBe(1);
    expect(scritto[0].verifierVerdict).toBe(null);
  });

  test('una prova del giro SPOSTATA fuori dalla cartella (rinomina senza righe cambiate) non si fonde', async () => {
    const diff = [
      'diff --git a/tests/verifica/12/giro1.spec.mjs b/tests/giro1.spec.mjs',
      'similarity index 100%',
      'rename from tests/verifica/12/giro1.spec.mjs',
      'rename to tests/giro1.spec.mjs',
      '',
    ].join('\n');
    expect((await cancello(diff)).r.ok).toBe(false);
  });

  test('una rinomina dentro la cartella con un nome che imita l\'intestazione non si fonde', async () => {
    const diff = [
      'diff --git a/tests/verifica/12/q b/tests/verifica/12/z b/tests/verifica/12/q b/src/evil.js',
      'similarity index 100%',
      'rename from tests/verifica/12/q b/tests/verifica/12/z',
      'rename to tests/verifica/12/q b/src/evil.js',
      '',
    ].join('\n');
    expect((await cancello(diff)).r.ok).toBe(false);
  });

  test('una prova del giro resa eseguibile (solo il modo del file) non si fonde', async () => {
    const diff = [
      'diff --git a/tests/verifica/12/giro1.spec.mjs b/tests/verifica/12/giro1.spec.mjs',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n');
    expect((await cancello(diff)).r.ok).toBe(false);
  });

  test('un file tolto FUORI dalle prove del giro (una sentinella degli unit test) non si fonde', async () => {
    const diff = [
      'diff --git a/tests/unit/proveDeiGiri.test.mjs b/tests/unit/proveDeiGiri.test.mjs',
      'deleted file mode 100644',
      'index fde3ce3..0000000',
      '--- a/tests/unit/proveDeiGiri.test.mjs',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      "-test('sentinella', () => {});",
      '',
    ].join('\n');
    expect((await cancello(diff)).r.ok).toBe(false);
  });

  test('un file nuovo nelle prove del giro, anche letto come binario, non si fonde', async () => {
    const diff = [
      'diff --git a/tests/verifica/12/nuovo.spec.mjs b/tests/verifica/12/nuovo.spec.mjs',
      'new file mode 100644',
      'index 0000000..9b27970',
      'Binary files /dev/null and b/tests/verifica/12/nuovo.spec.mjs differ',
      '',
    ].join('\n');
    expect((await cancello(diff)).r.ok).toBe(false);
  });

  test('una riga aggiunta che comincia con «++» dentro un blocco non si fonde', async () => {
    const diff = TOLTO_UN_CASO.replace("-test('caso due', async () => {", "+++globalThis.n; require('child_process').execSync('echo preso');");
    expect((await cancello(diff)).r.ok).toBe(false);
  });
});
