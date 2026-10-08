// #1059: ogni modello scritto nel repo ha il produttore fra i fornitori esclusi, così un produttore nuovo
// diventa rosso invece di passare in silenzio. Fanno eccezione Anthropic e i modelli stretti della politica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
const ESCLUSI = C.DEFAULT_EXCLUDED_PROVIDERS;

// Il codice, il registro di prova che fa da registro di build e i modelli di test:explore.
const DOVE = ['src', 'scripts', join('tests', 'fixtures'), join('tests', 'agent')];

function sorgenti(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sorgenti(p, out);
    else if (/\.(m?js|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

const PREFISSI_NOTI = new Set([
  ...C.MODEL_PRODUCERS.map((p) => p.prefix),
  ...C.PRODUCER_ONLY_MODELS.map((r) => r.prefix.replace(/\/$/, '')),
  ...C.NARROW_MODELS.map((m) => m.prefix.replace(/\/$/, '')),
]);

// Un id dello smistatore è «autore/modello»; un percorso o un tipo MIME non porta trattino e cifra insieme.
function sembraUnModello(prefisso, nome) {
  if (/\.(m?js|css|html?|json|md|png|svg|txt|ico|webp|jpe?g)$/.test(nome)) return false;
  return PREFISSI_NOTI.has(prefisso) || (nome.includes('-') && /\d/.test(nome));
}

function modelliNelRepo() {
  const out = [];
  const re = /(['"`])(~?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._:-]*))\1/g;
  for (const dir of DOVE) {
    for (const file of sorgenti(join(ROOT, dir))) {
      const testo = readFileSync(file, 'utf8');
      for (const m of testo.matchAll(re)) {
        if (sembraUnModello(m[3], m[4])) out.push({ id: m[2], prefisso: m[3], file: relative(ROOT, file) });
      }
    }
  }
  return out;
}

test('il censimento trova i modelli scritti nel repo', () => {
  const ids = new Set(modelliNelRepo().map((m) => m.id));
  for (const atteso of ['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4-pro', 'moonshotai/kimi-k2.6', 'anthropic/claude-haiku-4.5']) {
    assert.ok(ids.has(atteso), `il censimento non vede ${atteso}: la sentinella guarderebbe nel vuoto`);
  }
});

test('ogni modello di serie viene da un produttore censito ed escluso come fornitore', () => {
  const rossi = [];
  for (const { id, prefisso, file } of modelliNelRepo()) {
    if (!PREFISSI_NOTI.has(prefisso)) {
      rossi.push(`${id} (${file}): produttore «${prefisso}» sconosciuto, va in MODEL_PRODUCERS e la sua forma base in DEFAULT_EXCLUDED_PROVIDERS`);
      continue;
    }
    const fuori = C.producerNotExcluded(id, ESCLUSI);
    if (fuori) rossi.push(`${id} (${file}): il produttore «${fuori}» non è in DEFAULT_EXCLUDED_PROVIDERS`);
  }
  assert.deepEqual(rossi, []);
});

test('ogni produttore che vende inferenza è nella lista, Xiaomi compreso', () => {
  for (const p of C.MODEL_PRODUCERS) {
    if (!p.host) continue;
    assert.ok(C.isProviderExcluded(p.host, ESCLUSI), `${p.host} (${p.prefix}/) manca da DEFAULT_EXCLUDED_PROVIDERS`);
  }
  assert.equal(C.producerNotExcluded('xiaomi/mimo-v2.6-flash', ESCLUSI), '');
  assert.equal(C.producerNotExcluded('xiaomi/mimo-v2.6-flash', ESCLUSI.filter((n) => n !== 'Xiaomi')), 'Xiaomi');
  const motivo = C.excludedProviderReasons(['Xiaomi'], [], C.DEFAULT_EXCLUDED_PROVIDER_REASONS)[0];
  assert.equal(motivo.kind, 'producer');
});

test('le sole eccezioni sono Anthropic e i modelli stretti che la politica nomina', () => {
  assert.equal(C.producerNotExcluded('anthropic/claude-haiku-4.5', []), '');
  assert.equal(C.producerNotExcluded('~anthropic/claude-sonnet-latest', []), '');
  const politica = readFileSync(join(ROOT, 'transparency', 'models.md'), 'utf8');
  const ammessi = (politica.match(/^\*\*Ammessi oggi:\*\*.*$/m) || [''])[0];
  for (const m of C.NARROW_MODELS) {
    assert.ok(ammessi.includes(m.producer), `${m.producer} è un modello stretto ma la politica non lo nomina fra gli ammessi`);
    assert.equal(C.producerNotExcluded(`${m.prefix}modello-1`, []), '');
  }
});

test('un produttore che nessuno ha censito si vede col suo prefisso', () => {
  assert.equal(C.producerNotExcluded('stepfun/step-3.5-flash', ESCLUSI), 'stepfun');
  assert.equal(C.producerNotExcluded('StepFun/Step-3.5-Flash', ['StepFun']), '');
  assert.equal(C.producerNotExcluded('meta-llama/llama-4-maverick:free', ['Google']), 'Meta');
  assert.equal(C.producerNotExcluded('hexgrad/kokoro-82m', []), '', 'chi non vende inferenza non ha un fornitore da escludere');
  for (const vuoto of ['', '   ', null, undefined, 'senza-prefisso', '/solo-nome']) {
    assert.equal(C.producerNotExcluded(vuoto, ESCLUSI), '');
  }
});
