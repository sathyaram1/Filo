// #1974 — dalle liste di uAssets alle sole regole di iniezione per YouTube: blocchi «!#if», argomenti, domini, eccezioni.
// Le righe qui sono scritte a mano nella stessa forma delle liste: le liste vere le prova tests/youtube-blocco.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../src/main/services/regoleYouTube.js');

test('gli argomenti: virgolette, virgole protette e vuoti restano come li ha scritti la lista', () => {
  assert.deepEqual(R.argomenti('set, a.b, undefined'), ['set', 'a.b', 'undefined']);
  assert.deepEqual(R.argomenti(`trusted-rpfr, '"x"', '"y, z"', player?`), ['trusted-rpfr', '"x"', '"y, z"', 'player?']);
  assert.deepEqual(R.argomenti('rmnt, script, window\\,"fetch"'), ['rmnt', 'script', 'window,"fetch"']);
  assert.deepEqual(R.argomenti('json-prune-fetch-response, a b, , propsToMatch, /\\/p(\\?|$)/'),
    ['json-prune-fetch-response', 'a b', '', 'propsToMatch', '/\\/p(\\?|$)/']);
  assert.deepEqual(R.argomenti('x, /a{2\\,4}/'), ['x', '/a{2,4}/']);
});

test('i blocchi «!#if» valgono come per uBlock su Chromium senza filtraggio dell\'HTML', () => {
  const testo = [
    '!#if env_firefox', 'www.youtube.com##+js(set, solo.firefox, true)', '!#endif',
    '!#if !cap_html_filtering', 'www.youtube.com##+js(set, senza.html, true)', '!#else', 'www.youtube.com##+js(set, con.html, true)', '!#endif',
    '!#if env_chromium && !env_mobile', 'www.youtube.com##+js(set, chromium, true)', '!#endif',
    '!#if !env_mv3', '!#if env_firefox', 'www.youtube.com##+js(set, annidata, true)', '!#endif', '!#endif',
  ].join('\n');
  const catene = R.perHost(R.leggi(testo), 'www.youtube.com').map((r) => r[1]);
  assert.deepEqual(catene, ['senza.html', 'chromium']);
});

test('entrano solo le regole che nominano YouTube; il resto delle liste resta fuori', () => {
  const testo = [
    'www.youtube.com##+js(set, a, 1)',
    'm.youtube.com,youtube-nocookie.com##+js(set, b, 2)',
    'youtube.com##+js(set, c, 3)',
    'esempio.it##+js(set, d, 4)',
    'altro.*,~youtube.com##+js(set, e, 5)',
    '##+js(set, f, 6)',
    '*##+js(set, g, 7)',
    '! www.youtube.com##+js(set, commento, 8)',
    'youtube.*##+js(set, h, 9)',
    'www.youtube.com##.banner',
  ].join('\n');
  const ins = R.leggi(testo);
  assert.deepEqual(R.perHost(ins, 'www.youtube.com').map((r) => r[1]), ['a', 'c', 'h']);
  assert.deepEqual(R.perHost(ins, 'www.youtube-nocookie.com').map((r) => r[1]), ['b']);
  assert.deepEqual(R.perHost(ins, 'm.youtube.com').map((r) => r[1]), ['b', 'c', 'h']);
  assert.deepEqual(R.perHost(ins, 'esempio.it'), [], 'fuori da YouTube non si inietta niente');
});

test('nomi lunghi e brevi diventano lo stesso scriptlet; uno sconosciuto si scarta e si conta', () => {
  const ins = R.leggi([
    'www.youtube.com##+js(set-constant.js, a, true)',
    'www.youtube.com##+js(trusted-replace-fetch-response, x, y, z)',
    'www.youtube.com##+js(nano-setTimeout-booster, [native code], 17000, 0.001)',
    'www.youtube.com##+js(inventato, x)',
  ].join('\n'));
  assert.deepEqual(R.perHost(ins, 'www.youtube.com').map((r) => r[0]), ['set', 'trusted-rpfr', 'nano-stb']);
  assert.deepEqual(ins.ignote, ['inventato']);
});

test('la stessa regola in due liste si esegue una volta', () => {
  const riga = 'www.youtube.com##+js(json-prune, adPlacements)';
  const ins = R.leggi(riga, `${riga}\n${riga}`);
  assert.equal(R.perHost(ins, 'www.youtube.com').length, 1);
});

test('le eccezioni tolgono la regola uguale, o tutte con «#@#+js()»', () => {
  const regole = 'youtube.com##+js(set, a, 1)\nyoutube.com##+js(set, b, 2)';
  const una = R.leggi(regole, 'www.youtube.com#@#+js(set, a, 1)');
  assert.deepEqual(R.perHost(una, 'www.youtube.com').map((r) => r[1]), ['b']);
  assert.deepEqual(R.perHost(una, 'm.youtube.com').map((r) => r[1]), ['a', 'b'], 'l\'eccezione vale solo dove la lista la scrive');
  const tutte = R.leggi(regole, 'm.youtube.com#@#+js()');
  assert.deepEqual(R.perHost(tutte, 'm.youtube.com'), []);
  assert.equal(R.perHost(tutte, 'www.youtube.com').length, 2);
  const altrove = R.leggi(regole, 'esempio.it#@#+js()');
  assert.equal(R.perHost(altrove, 'www.youtube.com').length, 2);
});

test('«!#include» porta solo a file accanto alla lista, e solo dai blocchi che valgono', () => {
  const testo = [
    '!#include filters-2026.txt',
    '!#include ../altro/server.txt',
    '!#include https://male.example/lista.txt',
    '!#if env_firefox', '!#include solo-firefox.txt', '!#endif',
    '!#include filters-2026.txt',
  ].join('\n');
  assert.deepEqual(R.inclusi(testo), ['filters-2026.txt']);
});

test('gli host di YouTube: i sottodomini sì, i nomi che gli somigliano no', () => {
  for (const h of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtubekids.com']) assert.ok(R.hostYouTube(h), h);
  for (const h of ['notyoutube.com', 'youtube.com.esempio.it', 'youtube.it', '']) assert.ok(!R.hostYouTube(h), h);
  assert.equal(R.hostDi('https://www.youtube.com:8443/watch?v=x'), 'www.youtube.com');
  assert.equal(R.hostDi('filo://dashboard'), '');
});
