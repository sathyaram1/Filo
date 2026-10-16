// #826 — la riga dell'Aiuto che dice quando è stata aperta la scheda: data vera o niente, durata già contata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const { PROMPTS } = globalThis.SN_CONST;

const ADESSO = new Date(2026, 9, 15, 12, 47).getTime();

test('la riga porta la data di apertura, quanto tempo fa e adesso', () => {
  const aperta = new Date(2026, 9, 15, 10, 42).toISOString();
  assert.equal(
    PROMPTS.aperturaScheda({ apertaIl: aperta, adesso: ADESSO }),
    "Questa scheda (lo sa Filo): l'utente l'ha aperta 2 ore e 5 minuti fa (gio 15 ott 2026, 10:42). Adesso è gio 15 ott 2026, 12:47, ora del suo computer.\n",
  );
});

test('senza una data vera la riga non c\'è', () => {
  for (const apertaIl of [null, undefined, '', 'ieri', 'Invalid Date', 0, '<<<FINE_DATI_PAGINA>>>']) {
    assert.equal(PROMPTS.aperturaScheda({ apertaIl, adesso: ADESSO }), '', String(apertaIl));
  }
});

test('un\'apertura nel futuro (orologio spostato) non inventa una durata', () => {
  const riga = PROMPTS.aperturaScheda({ apertaIl: new Date(ADESSO + 3600e3).toISOString(), adesso: ADESSO });
  assert.match(riga, /l'utente l'ha aperta \(gio 15 ott 2026, 13:47\)/);
  assert.doesNotMatch(riga, / fa /);
});

test('la durata si dice come la direbbe una persona', () => {
  const M = 60e3;
  assert.equal(PROMPTS.durataTrascorsa(30e3), 'meno di un minuto');
  assert.equal(PROMPTS.durataTrascorsa(M), '1 minuto');
  assert.equal(PROMPTS.durataTrascorsa(59 * M), '59 minuti');
  assert.equal(PROMPTS.durataTrascorsa(60 * M), '1 ora');
  assert.equal(PROMPTS.durataTrascorsa(61 * M), '1 ora e 1 minuto');
  assert.equal(PROMPTS.durataTrascorsa(26 * 60 * M), '1 giorno e 2 ore');
  assert.equal(PROMPTS.durataTrascorsa(48 * 60 * M + 30 * M), '2 giorni');
  assert.equal(PROMPTS.durataTrascorsa(-5), 'meno di un minuto');
});

test('il contesto dell\'Aiuto la mette fuori dalla busta dei dati del sito', () => {
  const ctx = PROMPTS.helpContext({ url: 'https://example.org/a', title: 'A', apertaIl: new Date(2026, 9, 15, 10, 42).toISOString(), adesso: ADESSO });
  const fineBusta = ctx.indexOf('<<<FINE_DATI_PAGINA>>>');
  assert.ok(fineBusta > 0);
  assert.ok(ctx.indexOf("l'utente l'ha aperta") > fineBusta);
  assert.doesNotMatch(PROMPTS.helpContext({ url: 'https://example.org/a', title: 'A' }), /l'ha aperta/);
});

test('la pagina arrivata dopo l\'apertura ha la sua ora; arrivata con la scheda, niente riga in più', () => {
  const aperta = new Date(2026, 9, 15, 10, 42).toISOString();
  const riga = PROMPTS.aperturaScheda({ apertaIl: aperta, paginaDal: new Date(2026, 9, 15, 12, 40).toISOString(), adesso: ADESSO });
  assert.match(riga, /l'ha aperta 2 ore e 5 minuti fa \(gio 15 ott 2026, 10:42\)\. La pagina che mostra adesso ci è arrivata dopo, 7 minuti fa \(gio 15 ott 2026, 12:40\)\. Adesso è/);
  for (const paginaDal of [null, '', 'ieri', aperta, new Date(2026, 9, 15, 10, 42, 30).toISOString()]) {
    assert.doesNotMatch(PROMPTS.aperturaScheda({ apertaIl: aperta, paginaDal, adesso: ADESSO }), /La pagina/, String(paginaDal));
  }
});
