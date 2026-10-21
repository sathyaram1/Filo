// Sentinella: Filo non tocca un riquadro dello stesso sito ancora in arrivo (#1568). Toccato prima che parta il suo
// preload (leggerne la finestra o il documento, eseguirci codice) il riquadro resta senza Filo: niente menu del tasto
// destro lì dentro. Ogni tocco nel codice delle pagine chiede prima a SN_RIQUADRO_IN_VOLO, o sta nell'elenco col perché.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARTELLE = ['src/preload', 'src/content', 'src/shared'];
const TOCCO = /\.(contentWindow|contentDocument)\b|\.executeJavaScriptInIsolatedWorld\(/;
const GUARDIA = /IN_VOLO|inVolo\(|inArrivo\(|riquadroInVolo\(/;
const RIGHE_SOPRA = 6;

// File → frammento della riga → perché il riquadro lì è già arrivato.
const ECCEZIONI = {
  'src/preload/wheel-zoom.js': {
    "addEventListener('load', () => aggancia(el.contentWindow))": 'dentro il load del riquadro',
  },
  'src/preload/page-preload.js': {
    'f.contentWindow.postMessage({ filoFrameVerdict': 'la lista viene da riquadriFigli, che salta quelli in arrivo',
    'c.executeJavaScriptInIsolatedWorld(MONDO_DEL_PRELOAD': 'alla cieca solo con inAttesa vuoto',
  },
  'src/content/propostaEmail.js': {
    'ifr.contentWindow !== sorgente': 'il riquadro col fuoco, da cui è appena arrivato il segno',
  },
};

function file(cartella) {
  return readdirSync(join(ROOT, cartella)).filter((n) => n.endsWith('.js')).map((n) => `${cartella}/${n}`);
}

test('ogni tocco a un riquadro chiede prima se è ancora in arrivo', () => {
  const scoperti = [];
  const usate = new Set();
  for (const rel of CARTELLE.flatMap(file)) {
    const righe = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    righe.forEach((riga, i) => {
      if (!TOCCO.test(riga) || /^\s*\/\//.test(riga)) return;
      if (righe.slice(Math.max(0, i - RIGHE_SOPRA), i + 1).some((r) => GUARDIA.test(r))) return;
      const ecc = Object.keys(ECCEZIONI[rel] || {}).find((k) => riga.includes(k));
      if (ecc) { usate.add(`${rel}|${ecc}`); return; }
      scoperti.push(`${rel}:${i + 1}: ${riga.trim()}`);
    });
  }
  assert.deepEqual(scoperti, [], 'riquadri toccati senza chiedere se sono in arrivo (o eccezione col perché qui sopra)');
  const vecchie = Object.entries(ECCEZIONI).flatMap(([f, m]) => Object.keys(m).map((k) => `${f}|${k}`)).filter((k) => !usate.has(k));
  assert.deepEqual(vecchie, [], 'eccezioni che non corrispondono più a nessuna riga: si tolgono');
});

test('la regola sta nel preload della pagina, e chi la usa la chiede lì', () => {
  const preload = readFileSync(join(ROOT, 'src/preload/page-preload.js'), 'utf8');
  assert.match(preload, /globalThis\.SN_RIQUADRO_IN_VOLO = riquadroInVolo;/);
  assert.match(preload, /globalThis\.SN_RIQUADRO_SEGNA = /);
  // Il preload di un riquadro si presenta all'antenato con Filo: è così che si vede l'arrivo dentro un'ombra.
  assert.match(preload, /p\.SN_RIQUADRO_SEGNA\(el\)/);
  // Una seconda copia della regola divergerebbe: nessun altro file la riscrive.
  for (const rel of CARTELLE.flatMap(file)) {
    if (rel === 'src/preload/page-preload.js') continue;
    const testo = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(testo, /about:blank\(\[\?#\]\|\$\)/, `${rel} riscrive la regola dei riquadri in arrivo`);
  }
});
