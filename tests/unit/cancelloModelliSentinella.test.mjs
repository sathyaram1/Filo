// Sentinella (#591): ai fornitori di modelli si arriva solo dal cancello (src/main/services/modelGate.js), che applica
// limite di spesa, conteggio dei costi e registrazione di chi ha servito. Una chiamata diretta da un altro file di
// src/ era la porta da cui giudice anti-phishing, blocco geografico, voce e titoli dei feedback spendevano senza limite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

const CANCELLO = 'src/main/services/modelGate.js';
const FORNITORI = 'src/main/services/providers/';
const LOADER = 'src/main/services/loader.js';

const VIETATI = [
  { re: /\bSN_PROVIDERS\b/, cosa: 'il router dei fornitori (SN_PROVIDERS)' },
  { re: /\bSN_PROVIDER_[A-Z0-9_]+\b/, cosa: 'un modulo fornitore (SN_PROVIDER_*)' },
  { re: /\bgetProvider\s*\(/, cosa: 'getProvider()' },
  { re: /\b(?:stream)?[cC]ompleteWithFallback\b/, cosa: 'completeWithFallback / streamCompleteWithFallback' },
  // Sul cancello gli stessi nomi sono ammessi: Gate.complete, modelGate.keyInfo…
  { re: /(?<![Gg]ate)\.(?:complete|streamComplete|synthesizeSpeech|transcribe|embed|lookupServedBy|keyInfo)\s*\(/, cosa: 'un metodo di un fornitore' },
  { re: /openrouter\.ai\/api\/v1\/(?:chat\/completions|completions|audio\/|embeddings|generation)/, cosa: 'un endpoint che fa lavorare un modello' },
  { re: /require\([^)]*['"/]providers\b/, cosa: 'un modulo fornitore caricato a mano', tranne: LOADER },
];

function senzaCommenti(riga) {
  const t = riga.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return riga.replace(/(^|\s)\/\/.*$/, '$1');
}

function violazioni(testo, file) {
  const out = [];
  testo.split('\n').forEach((riga, i) => {
    const codice = senzaCommenti(riga);
    for (const v of VIETATI) {
      if (v.tranne === file) continue;
      if (v.re.test(codice)) out.push(`${file}:${i + 1} tocca ${v.cosa}: ${riga.trim().slice(0, 140)}`);
    }
  });
  return out;
}

function sorgenti(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sorgenti(p, acc);
    else if (/\.(m?js|cjs|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

test('ai fornitori di modelli si arriva solo dal cancello: nessun altro file di src/ li chiama', () => {
  const trovate = [];
  for (const p of sorgenti(SRC)) {
    const file = relative(ROOT, p).split('\\').join('/');
    if (file === CANCELLO || file.startsWith(FORNITORI)) continue;
    trovate.push(...violazioni(readFileSync(p, 'utf8'), file));
  }
  assert.deepEqual(trovate, [], 'Chiamata a un fornitore fuori dal cancello: passa da modelGate (complete, stream, call), '
    + 'che applica limite di spesa, costo e chi ha servito.\n' + trovate.join('\n'));
});

test('la sentinella riconosce le chiamate dirette che c\'erano prima del cancello', () => {
  const vecchie = [
    'const r = await Providers.completeWithFallback({ attempts, messages });',
    'globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages }),',
    'const P = Providers.getProvider(a.provider);',
    'return await P.synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting: routing });',
    'const r = await P.embed({ apiKey, model, texts: [\'prova\'] });',
    'const result = await Providers.streamComplete({ provider, apiKey, model, messages });',
    'const P = globalThis.SN_PROVIDER_OPENROUTER;',
    "await fetch('https://openrouter.ai/api/v1/chat/completions', init);",
  ];
  for (const riga of vecchie) assert.equal(violazioni(riga, 'src/x.js').length > 0, true, riga);
  for (const riga of [
    'const r = await Gate.complete({ action, messages });',
    "const info = await Gate.keyInfo({ provider: 'openrouter', apiKey: key });",
    '// Providers.completeWithFallback era la porta vecchia',
    "const res = await fetch('https://openrouter.ai/api/v1/models' + q, { headers });",
  ]) assert.deepEqual(violazioni(riga, 'src/x.js'), [], riga);
});
