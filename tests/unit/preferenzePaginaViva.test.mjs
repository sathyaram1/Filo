// Sentinella: la pagina Preferenze aperta non è una fotografia.
// Ogni campo che il salvataggio riscrive va riallineato quando quella stessa
// impostazione cambia da fuori, o il primo tocco su una manopola rimanda
// indietro tutte le altre (#667). Il racconto sta nel file di pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORGENTE = readFileSync(join(ROOT, 'src/pages/preferences/preferences.js'), 'utf8');

// I campi raggiunti attraverso un aiutante invece che con $('id') diretto:
// l'aiutante va dichiarato qui, così uno nuovo non sfugge al confronto.
const AIUTANTI = {
  currentStyleText: 'agentStyleText',
  currentModelVoice: 'ttsModelVoice',
  volumeDa: null, // il suo argomento È l'id, e viene letto sotto
};

function corpo(nome) {
  const inizio = SORGENTE.indexOf(`function ${nome}(`);
  assert.ok(inizio >= 0, `la pagina Preferenze non ha più ${nome}`);
  const fine = SORGENTE.indexOf('\n  }\n', inizio);
  assert.ok(fine > inizio, `non riesco a delimitare ${nome}`);
  return SORGENTE.slice(inizio, fine);
}

function campiLetti(testo) {
  const ids = new Set();
  for (const m of testo.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) ids.add(m[1]);
  for (const m of testo.matchAll(/volumeDa\('([A-Za-z0-9_]+)'\)/g)) ids.add(m[1]);
  for (const [aiutante, id] of Object.entries(AIUTANTI)) {
    if (id && new RegExp(`\\b${aiutante}\\(`).test(testo)) ids.add(id);
  }
  return ids;
}

test('ogni campo che il salvataggio riscrive viene riallineato al cambio da fuori', () => {
  const salvati = campiLetti(corpo('persist'));
  assert.ok(salvati.size > 10, 'il salvataggio deve leggere i campi della pagina');

  const riallineo = corpo('riallineaDaFuori');
  const scoperti = [...salvati].filter((id) => !riallineo.includes(`'${id}'`));
  assert.deepEqual(scoperti, [], `campi salvati ma mai riallineati: ${scoperti.join(', ')}`);
});

test('un aiutante nuovo del salvataggio non passa inosservato', () => {
  const chiamate = [...corpo('persist').matchAll(/\b([a-z][A-Za-z0-9_]*)\(/g)].map((m) => m[1]);
  const note = new Set([
    ...Object.keys(AIUTANTI),
    'parseFloat', 'parseInt', 'clampIdleHours', 'clampNotifDurationSec',
    'persist', 'trim', 'sendMessage', 'applyTheme', 'applyTextScale', 'flashSaved',
  ]);
  const ignote = [...new Set(chiamate)].filter((c) => !note.has(c));
  assert.deepEqual(ignote, [], `aiutanti nuovi nel salvataggio: dichiarali in AIUTANTI (${ignote.join(', ')})`);
});

test('la pagina ascolta davvero i cambiamenti arrivati da fuori', () => {
  assert.match(
    SORGENTE,
    /onMessage\.addListener[\s\S]{0,200}SETTINGS_UPDATED[\s\S]{0,120}riallineaDaFuori/,
    'la pagina Preferenze deve riallinearsi al messaggio di impostazioni cambiate',
  );
});

test('il campo che l\'utente sta usando non viene riscritto sotto le dita', () => {
  assert.match(corpo('riallineaDaFuori'), /document\.activeElement/);
});
