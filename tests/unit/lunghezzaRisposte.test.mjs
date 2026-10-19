// #1097.3 — il tetto di una risposta (max_tokens) per famiglia di funzioni: ogni funzione che scrive testo ne ha uno,
// l'utente vince sull'owner e l'owner sul codice, e Preferenze e chat lo cambiano allo stesso modo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'lunghezzaRisposte.js'));
require(join(ROOT, 'src', 'shared', 'preferences.js'));
require(join(ROOT, 'src', 'shared', 'cambi.js'));
const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
const { ACTIONS } = globalThis.SN_CONST;

test('ogni funzione che scrive testo ha una famiglia; voce, dettatura e vettori no', () => {
  const senza = new Set([ACTIONS.TTS, ACTIONS.TRANSCRIBE_AUDIO, ACTIONS.ARCHIVE_EMBED, ACTIONS.MANAGE_SEARCH_CLASSIFY]);
  for (const a of Object.values(ACTIONS)) {
    if (senza.has(a)) assert.equal(LR.famigliaDi(a), null, a);
    else assert.ok(LR.FAMIGLIE.includes(LR.famigliaDi(a)), a);
  }
  assert.equal(LR.famigliaDi(ACTIONS.FILO_CHAT), 'conversazioni');
  assert.equal(LR.famigliaDi(ACTIONS.TRANSLATE_PAGE), 'testi');
  assert.equal(LR.famigliaDi(ACTIONS.EXPLAIN), 'brevi');
  // Una funzione che nessuno ha ancora messo in un elenco prende il tetto largo, mai quello stretto.
  assert.equal(LR.famigliaDi('funzione_nuova'), 'testi');
});

test('l\'utente vince sull\'owner, l\'owner sul codice; vuoto vuol dire predefinito; fuori scala torna dentro', () => {
  assert.equal(LR.perAzione(ACTIONS.FILO_CHAT, null, null), LR.DI_SERIE.conversazioni);
  assert.equal(LR.perAzione(ACTIONS.FILO_CHAT, null, { conversazioni: 32768 }), 32768);
  assert.equal(LR.perAzione(ACTIONS.FILO_CHAT, { conversazioni: 4096 }, { conversazioni: 32768 }), 4096);
  assert.equal(LR.perAzione(ACTIONS.FILO_CHAT, { conversazioni: '' }, { conversazioni: 32768 }), 32768);
  assert.equal(LR.perAzione(ACTIONS.EXPLAIN, { brevi: 5 }, null), LR.LIMITI[0]);
  assert.equal(LR.perAzione(ACTIONS.EXPLAIN, { brevi: 10_000_000 }, null), LR.LIMITI[1]);
  assert.equal(LR.perAzione(ACTIONS.TTS, { brevi: 2000 }, null), null);
  assert.deepEqual(LR.tetti({ testi: 2048 }, null).da, { conversazioni: 'codice', testi: 'utente', brevi: 'codice' });
});

test('in chat: «la chat può rispondere fino a 32 mila token», e «predefinito» lo rimette', () => {
  const P = globalThis.SN_PREF;
  const r = P.buildPreferencePartial('lunghezza delle risposte della chat', '32 mila');
  assert.deepEqual(r.partial, { lunghezzaRisposte: { conversazioni: 32000 } });
  assert.deepEqual(P.buildPreferencePartial('lunghezza dei riassunti', '20k').partial, { lunghezzaRisposte: { testi: 20000 } });
  assert.deepEqual(P.buildPreferencePartial('lunghezzarisposte.brevi', 'predefinito').partial, { lunghezzaRisposte: { brevi: null } });
  assert.equal(globalThis.SN_CAMBI.fraseCambio({ chiave: 'lunghezzaRisposte.conversazioni', prima: null, dopo: 32000 }),
    'lunghezza massima delle risposte della chat e delle conversazioni: come i predefiniti → 32.000 token');
});
