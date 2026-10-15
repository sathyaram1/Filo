// Unit test — quale chiave paga una chiamata quando «usa modelli predefiniti» è acceso (#1107).
// Regola: per ogni servizio vince la chiave che l'utente ha scritto; quella di fabbrica è il ripiego.
// Prima per la ricerca valeva il contrario: la chiave Tavily dell'utente non veniva mai usata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

const FABBRICA = { openrouter: 'or-fabbrica', tavily: 'tav-fabbrica' };

test('ricerca: la chiave Tavily dell\'utente vince su quella di fabbrica', () => {
  const k = C.effectiveApiKeys({ tavily: 'tav-utente' }, '', FABBRICA);
  assert.equal(k.tavily, 'tav-utente');
});

test('ricerca: senza chiave dell\'utente si usa quella di fabbrica', () => {
  assert.equal(C.effectiveApiKeys({}, '', FABBRICA).tavily, 'tav-fabbrica');
  assert.equal(C.effectiveApiKeys(undefined, '', FABBRICA).tavily, 'tav-fabbrica');
  assert.equal(C.effectiveApiKeys({ tavily: '' }, '', FABBRICA).tavily, 'tav-fabbrica');
});

test('una chiave di soli spazi non è una chiave: non toglie il posto al ripiego', () => {
  const k = C.effectiveApiKeys({ tavily: '   ', openrouter: ' \t' }, '', FABBRICA);
  assert.equal(k.tavily, 'tav-fabbrica');
  assert.equal(k.openrouter, 'or-fabbrica');
  assert.equal(C.effectiveApiKeys({ tavily: '  tav-utente \n' }, '', FABBRICA).tavily, 'tav-utente');
});

test('OpenRouter (#598): utente, poi chiave personale del riscatto, poi fabbrica', () => {
  assert.equal(C.effectiveApiKeys({ openrouter: 'or-utente' }, 'or-personale', FABBRICA).openrouter, 'or-utente');
  assert.equal(C.effectiveApiKeys({}, 'or-personale', FABBRICA).openrouter, 'or-personale');
  assert.equal(C.effectiveApiKeys({}, '', FABBRICA).openrouter, 'or-fabbrica');
});

test('la chiave personale del riscatto è di OpenRouter: non diventa una chiave di ricerca', () => {
  assert.equal(C.effectiveApiKeys({}, 'or-personale', {}).tavily, '');
});

test('nessuna chiave da nessuna parte: stringhe vuote, mai undefined', () => {
  assert.deepEqual(C.effectiveApiKeys(undefined, undefined, undefined), { openrouter: '', tavily: '' });
});

// La regola vive in un posto solo: se withDefaults torna a decidere l'ordine da sé, le due
// strade possono di nuovo divergere come prima del #1107.
test('withDefaults chiede l\'ordine delle chiavi a SN_CONST.effectiveApiKeys', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(src, /SN_CONST\.effectiveApiKeys\(/);
  assert.doesNotMatch(src, /apiKeys\.tavily\s*=/);
});
