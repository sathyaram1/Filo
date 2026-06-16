// Unit test per src/shared/pageRestyle.js — sanificazione del CSS che Filo
// inietta nella pagina su richiesta in chat (#185, "scrivi in grassetto tutti i
// titoli"). Il CSS arriva da un LLM: questo modulo è la barriera di sicurezza
// che impedisce iniezioni (graffe per uscire dalla regola, @import/url() per
// caricare risorse esterne, markup). Gli assert verificano il SUCCESSO (le
// regole legittime passano e producono il CSS giusto) E il blocco (le regole
// pericolose vengono scartate, non "aggiustate").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'pageRestyle.js'));

const R = globalThis.SN_PAGE_RESTYLE;

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(R);
  assert.equal(typeof R.normalizeRules, 'function');
  assert.equal(typeof R.buildCss, 'function');
});

test('"scrivi in grassetto tutti i titoli" → CSS valido sui titoli', () => {
  const rules = R.normalizeRules({
    descrizione: 'titoli in grassetto',
    regole: [{ selettore: 'h1,h2,h3,h4,h5,h6', css: 'font-weight: 700' }],
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, 'h1,h2,h3,h4,h5,h6');
  assert.match(rules[0].css, /font-weight:\s*700;/);
  const css = R.buildCss(rules);
  assert.equal(css, 'h1,h2,h3,h4,h5,h6 { font-weight: 700; }');
});

test('accetta i sinonimi che un LLM può produrre (selector/style, rules)', () => {
  const a = R.normalizeRules({ rules: [{ selector: 'a', style: 'color: red' }] });
  assert.equal(a.length, 1);
  assert.equal(a[0].selector, 'a');
  assert.match(a[0].css, /color:\s*red;/);
});

test('normalizza una singola regola passata come oggetto azione "piatto"', () => {
  const a = R.normalizeRules({ selettore: 'p', css: 'font-size: 20px' });
  assert.equal(a.length, 1);
  assert.equal(a[0].selector, 'p');
});

test('toglie una coppia di graffe esterne che l\'LLM ha incluso per errore', () => {
  const a = R.normalizeRules({ selettore: 'p', css: '{ font-size: 20px }' });
  assert.equal(a.length, 1);
  assert.equal(a[0].css, 'font-size: 20px;');
});

test('SICUREZZA: scarta le dichiarazioni con graffe (tentativo di breakout)', () => {
  // "color:red} body{display:none" proverebbe a chiudere la regola e iniettarne
  // un'altra che nasconde tutta la pagina. Deve essere scartata, non applicata.
  const a = R.normalizeRules({ selettore: 'h1', css: 'color:red} body{display:none' });
  assert.equal(a.length, 0);
});

test('SICUREZZA: scarta @import (caricamento di CSS esterno)', () => {
  assert.equal(R.normalizeRules({ selettore: 'h1', css: '@import "http://evil/x.css"' }).length, 0);
});

test('SICUREZZA: scarta url() (richiesta di rete dal CSS)', () => {
  assert.equal(R.normalizeRules({ selettore: 'body', css: 'background: url(http://evil/beacon.gif)' }).length, 0);
});

test('SICUREZZA: scarta selettori con markup o graffe', () => {
  assert.equal(R.normalizeRules({ selettore: 'h1 <script>', css: 'color:red' }).length, 0);
  assert.equal(R.normalizeRules({ selettore: 'h1 { x', css: 'color:red' }).length, 0);
});

test('scarta dichiarazioni senza alcuna coppia prop:valore', () => {
  assert.equal(R.normalizeRules({ selettore: 'h1', css: 'garbage senza due punti' }).length, 0);
});

test('scarta regole con selettore o css vuoti', () => {
  assert.equal(R.normalizeRules({ selettore: '', css: 'color:red' }).length, 0);
  assert.equal(R.normalizeRules({ selettore: 'h1', css: '' }).length, 0);
});

test('più regole valide vengono tutte mantenute, le invalide filtrate', () => {
  const a = R.normalizeRules({
    rules: [
      { selettore: 'h1', css: 'color: blue' },
      { selettore: 'a', css: '@import x' },        // scartata
      { selettore: 'p', css: 'line-height: 1.6' },
    ],
  });
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((r) => r.selector), ['h1', 'p']);
});

test('buildCss vuoto quando non c\'è nulla di valido (Filo non inietta nulla)', () => {
  assert.equal(R.buildCss(R.normalizeRules({ selettore: 'h1', css: '@import evil' })), '');
  assert.equal(R.buildCss(R.normalizeRules({})), '');
});
