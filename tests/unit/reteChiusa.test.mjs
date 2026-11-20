// Sentinella di #1492.1: nessuna prova con siti finti manda alla rete vera quello che non serve. L'uscita dei gestori
// http/https delle prove è una sola, `resto` di tests/helpers/reteChiusa.mjs, e lì passa solo il server locale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const AIUTO = 'helpers/reteChiusa.mjs';

// Le prove dell'app e i loro aiuti; le cartelle dei giri di verifica non si toccano.
const FILE = [
  ...readdirSync(TESTS).filter((f) => f.endsWith('.spec.mjs')),
  ...['helpers', 'fixtures'].flatMap((d) => readdirSync(join(TESTS, d)).filter((f) => /\.m?js$/.test(f)).map((f) => `${d}/${f}`)),
].sort();
const testo = (f) => readFileSync(join(TESTS, f), 'utf8');

test('il passaggio alla rete vera dentro un gestore di protocollo sta solo nell\'aiuto condiviso', () => {
  const fuori = FILE.filter((f) => f !== AIUTO && /bypassCustomProtocolHandlers/.test(testo(f)));
  assert.deepEqual(fuori, [], `queste prove mandano alla rete vera quello che non servono: usino serviSiti o chiudiLaRete di tests/${AIUTO}`);
});

test('una prova che intercetta un protocollo non chiama net.fetch da sé', () => {
  const fuori = FILE.filter((f) => f !== AIUTO && /protocol\.handle\(/.test(testo(f)) && /\bnet\.fetch\(/.test(testo(f)));
  assert.deepEqual(fuori, [], `quello che il gestore non serve va a globalThis.__reteChiusa.resto(req) (tests/${AIUTO})`);
});

test('nell\'aiuto condiviso la rete vera la raggiunge solo il server locale', () => {
  const t = testo(AIUTO);
  const uscite = t.match(/\bnet\.fetch\(/g) || [];
  assert.equal(uscite.length, 1, 'una sola uscita verso la rete');
  assert.match(t, /if \(host === '127\.0\.0\.1'\) return net\.fetch\(req, \{ bypassCustomProtocolHandlers: true \}\);\n\s*return Response\.error\(\);/);
});
