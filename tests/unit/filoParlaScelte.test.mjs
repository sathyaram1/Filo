// #2294 — le scelte del ritmo dei messaggi sui download e il predefinito vivono in src/shared/constants.js: il menu di
// Preferenze, la riga con cui la chat cambia l'impostazione, il manifesto e il servizio li ripetono, e qui si confrontano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import '../../src/shared/constants.js';
import '../../src/shared/capabilities.js';

const require = createRequire(import.meta.url);
const C = globalThis.SN_CONST;
const SCELTE = [...C.FILO_PARLA_DOWNLOAD_MIN];
const PREDEFINITO = C.DEFAULT_SETTINGS.filoParla.downloadOgniMin;
const A_PAROLE = { 2: 'due minuti', 5: 'cinque minuti', 10: 'dieci minuti', 30: 'mezz\'ora', 60: 'un\'ora' };

test('il menu di Preferenze offre proprio le scelte delle costanti, ognuna con la sua stima', () => {
  const html = readFileSync(new URL('../../src/pages/preferences/preferences.html', import.meta.url), 'utf8');
  const menu = html.slice(html.indexOf('id="filoParlaDownload"'), html.indexOf('</select>', html.indexOf('id="filoParlaDownload"')));
  const opzioni = [...menu.matchAll(/<option value="(\d+)">([^<]*)<\/option>/g)];
  assert.deepEqual(opzioni.map((o) => Number(o[1])), SCELTE);
  for (const [, , testo] of opzioni) assert.match(testo, /\$ all'ora/);
  assert.ok(SCELTE.includes(PREDEFINITO), 'il predefinito è una delle scelte');
});

test('la riga con cui la chat cambia il ritmo elenca le stesse scelte', () => {
  const js = readFileSync(new URL('../../src/shared/preferences.js', import.meta.url), 'utf8');
  const riga = js.match(/aiuto: 'minuti ([\d |]+) \(quanto spesso al massimo Filo scrive da sé dei download/);
  assert.ok(riga, 'la riga d\'aiuto del ritmo c\'è ancora');
  assert.deepEqual(riga[1].split('|').map((x) => Number(x.trim())), SCELTE);
});

test('il manifesto dice il predefinito, e il servizio parte da lì', () => {
  const caps = JSON.stringify(globalThis.SN_CAPABILITIES || {});
  assert.ok(A_PAROLE[PREDEFINITO], `manca il nome a parole di ${PREDEFINITO} minuti in questa prova`);
  assert.ok(caps.includes(`Dei download Filo scrive al massimo ogni ${A_PAROLE[PREDEFINITO]}`), 'il manifesto nomina il predefinito');
  const Parla = require('../../src/main/services/filoParla.js');
  assert.equal(Parla._ritmoMs(), PREDEFINITO * 60_000);
});

test('dalla chat il ritmo si capisce anche a parole, e la conferma lo chiama come l\'elenco dei cambi', async () => {
  await import('../../src/shared/preferences.js');
  const build = (v) => globalThis.SN_PREF.buildPreferencePartial('messaggi sui download', v);
  const casi = { '30': 30, 'mezz\'ora': 30, 'mezz’ora': 30, 'ogni mezzora': 30, 'dieci minuti': 10, 'una volta ogni dieci minuti': 10,
    'cinque': 5, 'un\'ora': 60, 'ogni ora': 60, '2 ore': 60, '2': 2,
    // In secondi vale la scelta più breve, non lo stesso numero in minuti.
    '30 secondi': 2, 'ogni 45 sec': 2, '90s': 2, 'trenta secondi': 2 };
  for (const [v, atteso] of Object.entries(casi)) assert.equal(build(v)?.partial.filoParla.downloadOgniMin, atteso, `«${v}»`);
  for (const v of ['boh', '0', '']) assert.equal(build(v), null, `«${v}»`);
  const cambi = readFileSync(new URL('../../src/shared/cambi.js', import.meta.url), 'utf8');
  assert.match(cambi, /'filoParla\.downloadOgniMin':[^\n]*nomeRitmoDownload/, 'l\'elenco dei cambi usa lo stesso nome');
  for (const min of SCELTE) {
    const nome = C.nomeRitmoDownload(min);
    assert.equal(build(String(min)).label, `Messaggi sui download → ${nome}`);
    assert.doesNotMatch(nome, /ogni un'/);
  }
});
