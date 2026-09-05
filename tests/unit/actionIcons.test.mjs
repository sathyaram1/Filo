// Sentinella delle icone delle azioni dell'agente (src/shared/actionIcons.js):
// ogni azione registrata in actionLevels.js ha un'icona, ogni icona nominata
// esiste davvero nella libreria, e ogni SVG rispetta la famiglia di Filo
// (24×24, outline, tratto 1.75, niente testo, niente riempimenti).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = join(__dirname, '..', '..', 'src', 'shared');
require(join(shared, 'icons.js'));
require(join(shared, 'preferences.js'));
require(join(shared, 'themeTokens.js'));
require(join(shared, 'cmdClassify.js'));
require(join(shared, 'actionLevels.js'));
require(join(shared, 'actionIcons.js'));

const AI = globalThis.SN_ACTION_ICONS;
const ICONS = globalThis.SN_ICONS;
const REGISTRY = globalThis.SN_ACTION_LEVELS.REGISTRY;

test('ogni azione registrata ha un\'icona sua (non il ripiego)', () => {
  const senza = Object.keys(REGISTRY).filter((t) => !AI.AZIONI[t]);
  assert.deepEqual(senza, [], `azioni senza icona in actionIcons.js: ${senza.join(', ')}`);
});

test('ogni azione in AZIONI esiste nel registro dei livelli (niente voci morte)', () => {
  const morte = Object.keys(AI.AZIONI).filter((t) => !REGISTRY[t]);
  assert.deepEqual(morte, [], `voci di AZIONI che non sono più azioni: ${morte.join(', ')}`);
});

test('ogni nome di icona citato esiste nella libreria', () => {
  const tutti = { ...AI.AZIONI, ...AI.PREVISTE, ...AI.STATI, _ripiego: AI.RIPIEGO };
  const mancanti = Object.entries(tutti)
    .filter(([, n]) => typeof ICONS[n] !== 'function')
    .map(([t, n]) => `${t}→${n}`);
  assert.deepEqual(mancanti, []);
});

test('nome() è insensibile alle maiuscole e ripiega sul logo per i tipi ignoti', () => {
  assert.equal(AI.nome('cerca_web'), 'searchWeb');
  assert.equal(AI.nome('CERCA_WEB'), 'searchWeb');
  assert.equal(AI.nome('BOH'), 'filoLogo');
  assert.equal(AI.nome(''), 'filoLogo');
  assert.equal(AI.nome(null), 'filoLogo');
});

test('svg() restituisce un SVG della taglia chiesta (14 di default)', () => {
  const s = AI.svg('TIMER', 16);
  assert.ok(s.startsWith('<svg'));
  assert.match(s, /width="16" height="16"/);
  assert.match(AI.svg('TIMER'), /width="14" height="14"/);
  assert.equal(AI.svg('BOH', 12), ICONS.filoLogo(12));
});

test('le icone delle azioni rispettano la famiglia (24×24, outline, 1.75, dentro il margine)', () => {
  const nomi = new Set([...Object.values(AI.AZIONI), ...Object.values(AI.PREVISTE), ...Object.values(AI.STATI)]);
  for (const n of nomi) {
    const s = ICONS[n](20);
    assert.match(s, /viewBox="0 0 24 24"/, n);
    assert.match(s, /stroke-width="1.75"/, n);
    assert.match(s, /fill="none"/, n);
    assert.doesNotMatch(s, /<text/, `${n}: niente <text>`);
    assert.doesNotMatch(s, /fill="(?!none)/, `${n}: niente riempimenti`);
    // Coordinate assolute (x/y/cx/cy e i comandi M/L/H/V maiuscoli) entro
    // il quadro 24×24 con il margine di 2px: un tratto che sfora si taglia.
    const nums = [];
    for (const m of s.matchAll(/\b(?:x|y|cx|cy)="(-?[\d.]+)"/g)) nums.push(Number(m[1]));
    for (const m of s.matchAll(/[MLHV]\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?/g)) {
      nums.push(Number(m[1]));
      if (m[2] !== undefined) nums.push(Number(m[2]));
    }
    const fuori = nums.filter((v) => v < 2 || v > 22);
    assert.deepEqual(fuori, [], `${n}: coordinate fuori dal margine: ${fuori.join(', ')}`);
  }
});
