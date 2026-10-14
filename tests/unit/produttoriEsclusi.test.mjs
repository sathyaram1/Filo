// Sentinella — il produttore di ogni modello di serie sta fra i fornitori esclusi (#1059).
// Regola dell'owner del 06/10/2026: chi produce un modello a pesi aperti non ne serve le richieste.
// Fanno eccezione Anthropic e i modelli stretti elencati nella politica (transparency/models.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
const BASE = C.DEFAULT_EXCLUDED_PROVIDERS;

test('Xiaomi è escluso: il giudice MiMo non arriva al produttore', () => {
  assert.equal(C.uncoveredModelProducer('xiaomi/mimo-v2.6-flash', BASE), '');
  for (const served of ['Xiaomi', 'xiaomi', 'Xiaomi MiMo']) {
    assert.equal(C.servedPolicyViolation(served, 'xiaomi/mimo-v2.6-flash', BASE), 'excluded', served);
  }
  assert.ok(C.providerIgnoreList(BASE).includes('Xiaomi'));
  assert.equal(C.DEFAULT_EXCLUDED_PROVIDER_REASONS.find((r) => r.name === 'Xiaomi').kind, 'producer');
  // Gli host indipendenti che lo servono restano ammessi.
  for (const host of ['Darkbloom', 'GMICloud', 'DeepInfra', 'Io Net', 'Venice']) {
    assert.equal(C.isProviderExcluded(host, BASE), false, host);
  }
});

test('il produttore è il prefisso dell\'id, letto col nome della lista di esclusione', () => {
  const senza = BASE.filter((n) => n !== 'Xiaomi');
  assert.equal(C.uncoveredModelProducer('xiaomi/mimo-v2.6-flash', senza), 'Xiaomi');
  assert.equal(C.uncoveredModelProducer('z-ai/glm-5.3-flash', ['Z.AI']), '');
  assert.equal(C.uncoveredModelProducer('moonshotai/kimi-k2.6', ['Moonshot AI']), '');
  assert.equal(C.uncoveredModelProducer('~moonshotai/kimi-latest', ['Moonshot AI']), '');
  assert.equal(C.uncoveredModelProducer('meta-llama/llama-4-maverick:free', ['Meta']), '');
  assert.equal(C.uncoveredModelProducer('mistralai/mistral-small-3.2', ['Mistral']), '');
  assert.equal(C.uncoveredModelProducer('x-ai/grok-4', ['xAI']), '');
  assert.equal(C.uncoveredModelProducer('DeepSeek/DeepSeek-V4-Pro', ['DeepSeek']), '');
  // Una variante non copre la forma base: Google Vertex resterebbe libero.
  assert.equal(C.uncoveredModelProducer('google/gemma-4-31b-it', ['Google AI Studio']), 'Google');
  // Un produttore che la lista non conosce si nomina com'è scritto nell'id.
  assert.equal(C.uncoveredModelProducer('acme/modello-1', BASE), 'acme');
  assert.equal(C.uncoveredModelProducer('acme/modello-1', ['ACME']), '');
});

test('Anthropic e i modelli stretti non hanno produttore da escludere; senza prefisso non si giudica', () => {
  for (const id of ['anthropic/claude-haiku-4.5', '~anthropic/claude-sonnet-latest', 'typesafe/jev-1.13', '~typesafe/jev-latest']) {
    assert.equal(C.modelProducer(id), '', id);
    assert.equal(C.uncoveredModelProducer(id, []), '', id);
  }
  for (const id of ['deepseek', '', '  ', null, undefined, '/senza-produttore']) {
    assert.equal(C.uncoveredModelProducer(id, []), '', String(id));
  }
});

// ── I modelli di serie del repo ──────────────────────────────────────────────
// I modelli veri stanno nella configurazione condivisa; nel repo restano quelli che il codice
// sceglie da sé, il listino, le migrazioni, i modelli dei test e degli strumenti. Un id di
// modello ha una versione (una cifra) o è un alias «~…»/«…-latest»: così i percorsi non contano.

const DIRS = ['src', 'scripts', 'tests/fixtures', 'tests/agent', 'tests/helpers', 'routines'];
const SKIP = new Set([path.join('src', 'vendor')]);
const MIME = new Set(['application', 'text', 'image', 'audio', 'video', 'font', 'multipart', 'message', 'model']);
const ID = /^~?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)(:[a-z0-9-]+)?$/;
const FILE = /\.(m?js|cjs|json|png|svg|html|css|md|txt|ico|wav|mp3|ogg|webm|jpe?g|gif|pdf|zip|exe|dmg)$/i;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.has(path.relative(ROOT, p)) || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) files(p, out);
    else if (/\.(m?js|cjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Gli esempi nei commenti non sono modelli usati. Le righe si spezzano anche su CRLF.
function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}

function modelliDiSerie() {
  const out = new Map();
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of files(abs)) {
      for (const m of senzaCommenti(fs.readFileSync(f, 'utf8')).matchAll(/['"`]([^'"`\n]{3,100})['"`]/g)) {
        const v = m[1];
        const r = ID.exec(v);
        if (!r || MIME.has(r[1]) || FILE.test(r[2])) continue;
        if (!/\d/.test(r[2]) && !v.startsWith('~') && !/latest$/.test(r[2])) continue;
        if (!out.has(v)) out.set(v, path.relative(ROOT, f));
      }
    }
  }
  return out;
}

test('ogni modello di serie del repo ha il produttore fra i fornitori esclusi', () => {
  const modelli = modelliDiSerie();
  // La scansione deve vedere davvero i modelli: senza, la sentinella passerebbe a vuoto.
  for (const atteso of ['typesafe/jev-1.13', 'deepseek/deepseek-v4-pro', 'google/gemma-4-31b-it']) {
    assert.ok(modelli.has(atteso), `la scansione non trova ${atteso}`);
  }
  const scoperti = [...modelli]
    .map(([id, file]) => ({ id, file, produttore: C.uncoveredModelProducer(id, BASE) }))
    .filter((x) => x.produttore)
    .map((x) => `${x.file}: ${x.id} → ${x.produttore}`);
  assert.deepEqual(scoperti, [],
    'il produttore di questi modelli non è in DEFAULT_EXCLUDED_PROVIDERS (src/shared/constants.js) e '
    + 'può servirne le richieste: aggiungilo lì e nella copia del server (filo-security, modelPolicy.js). '
    + 'Se è un modello stretto ammesso dalla politica va in NARROW_MODELS e in transparency/models.md.\n'
    + scoperti.join('\n'));
});

test('i modelli stretti esentati dal codice sono quelli che la politica ammette per nome', () => {
  const documento = fs.readFileSync(path.join(ROOT, 'transparency', 'models.md'), 'utf8');
  const riga = documento.split('\n').find((r) => /\*\*Ammessi oggi:\*\*/.test(r)) || '';
  for (const { producer } of C.NARROW_MODELS) {
    assert.ok(riga.includes(`(${producer})`),
      `${producer} è esentato dalla lista di esclusione ma la politica non lo ammette in «Ammessi oggi»`);
  }
});
