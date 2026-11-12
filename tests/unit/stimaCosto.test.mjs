// #819 — accanto a ogni modello quanto costa un uso tipico della funzione, dal listino di OpenRouter e dai token medi
// dell'utente; un avviso se costa più di N volte il predefinito, solo coi crediti di Filo. Senza listino niente cifre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['constants', 'i18n', 'modelUsage', 'modelChainEditor', 'contenutoEsterno', 'preferences', 'wallet', 'stimaCosto']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const S = globalThis.SN_STIMA_COSTO;
const W = globalThis.SN_WALLET;
const P = globalThis.SN_PREF;
const { ACTIONS: A } = globalThis.SN_CONST;

// Come li manda `/api/v1/models`: dollari per token, in stringhe.
const CATALOGO = [
  { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: '0.0000004', completion: '0.0000008' } },
  { id: 'anthropic/claude-opus-4.5', pricing: { prompt: '0.000005', completion: '0.000025', input_cache_read: '0.0000005' } },
  { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
];
const REG = {
  deepseek: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  opus: { provider: 'openrouter', model: 'anthropic/claude-opus-4.5' },
  haiku: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
};
const TARIFFA = W.creditsPerUsd({ eurPerCredit: 0.0007, eurUsd: 1.1 });
function ctx(extra = {}) {
  return {
    modo: 'crediti', creditiPerDollaro: TARIFFA, listino: S.listinoDaCatalogo(CATALOGO), registro: {},
    soglia: 5, saldo: 4300, predefiniti: { [A.FILO_CHAT]: REG.deepseek }, ...extra,
  };
}

test('il listino viene dal catalogo di OpenRouter: dollari per token, «-1» (prezzo variabile) resta fuori', () => {
  const l = S.listinoDaCatalogo(CATALOGO);
  assert.deepEqual(l['deepseek/deepseek-v4-pro'], { prompt: 0.0000004, completion: 0.0000008 });
  assert.equal(l['anthropic/claude-opus-4.5'].cacheRead, 0.0000005);
  assert.equal(l['openrouter/auto'], undefined);
  // Le scorciatoie di smistamento costano come il modello base.
  assert.equal(S.prezzoDi(l, 'anthropic/claude-opus-4.5:nitro'), l['anthropic/claude-opus-4.5']);
});

test('senza un prezzo dal listino non esce nessuna cifra, nemmeno per un modello col prezzo scritto nel codice', () => {
  // claude-haiku-4.5 ha un prezzo in constants.js (NOTIONAL_PRICING, settings.pricing): la stima non deve usarlo.
  const v = S.valuta(A.FILO_CHAT, 'haiku', REG, ctx());
  assert.equal(v.ok, false);
  assert.equal(v.breve, 'prezzo non noto');
  assert.equal(v.valore, undefined);
  assert.doesNotMatch(v.testo, /credit|\$/);
  const senza = S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ listino: null }));
  assert.equal(senza.ok, false);
  assert.equal(senza.motivo, 'listino');
  assert.equal(senza.breve, 'listino non disponibile');
  assert.equal(senza.avviso, '');
});

test('crediti di un messaggio: listino × media prudente, poi × i token medi dell\'utente quando ce ne sono abbastanza', () => {
  const prudente = S.valuta(A.FILO_CHAT, 'deepseek', REG, ctx());
  const t = S.TIPI.conversazione;
  const usd = t.prompt * 0.0000004 + t.completion * 0.0000008;
  assert.equal(prudente.fonte, 'prudente');
  assert.ok(Math.abs(prudente.valore - usd * TARIFFA) < 1e-9);
  assert.match(prudente.perUso, /^circa [\d,.]+ crediti per messaggio$/);

  let registro = {};
  for (let i = 0; i < S.CAMPIONI_MINIMI; i++) {
    registro = S.aggiungiCampione(registro, A.FILO_CHAT, { prompt: 2000, completion: 100, model: 'x' });
  }
  const mio = S.valuta(A.FILO_CHAT, 'deepseek', REG, ctx({ registro }));
  assert.equal(mio.fonte, 'registro');
  assert.ok(Math.abs(mio.usd - (2000 * 0.0000004 + 100 * 0.0000008)) < 1e-12);
  assert.match(mio.testo, /token medi dei tuoi ultimi messaggi/);
});

test('i token letti dalla cache del fornitore costano il prezzo della cache, se il listino lo dice', () => {
  let registro = {};
  for (let i = 0; i < 3; i++) registro = S.aggiungiCampione(registro, A.FILO_CHAT, { prompt: 10000, cached: 8000, completion: 0 });
  const v = S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ registro }));
  assert.ok(Math.abs(v.usd - (2000 * 0.000005 + 8000 * 0.0000005)) < 1e-12);
});

test('un modello grande per la chat: la riga dice per quanti messaggi bastano i crediti, e la scelta resta quella', () => {
  const v = S.valuta(A.FILO_CHAT, 'opus', REG, ctx());
  const n = Math.floor(4300 / v.valore);
  assert.equal(v.avviso, `Con opus i tuoi 4.300 crediti bastano per circa ${n} messaggi.`);
  // Il predefinito non si avvisa da solo; sotto la soglia nemmeno.
  assert.equal(S.valuta(A.FILO_CHAT, 'deepseek', REG, ctx()).avviso, '');
  assert.equal(S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ soglia: 100 })).avviso, '');
  // Soglia 0 = mai.
  assert.equal(S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ soglia: 0 })).avviso, '');
  // Saldo non noto: si dice il rapporto col predefinito. Saldo che non basta: lo si dice.
  assert.match(S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ saldo: null })).avviso, /^Con opus ogni messaggio costa circa \d+ volte quello del modello predefinito\.$/);
  assert.match(S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ saldo: 20 })).avviso, /^Con opus ogni messaggio costa \d+ crediti: più dei 20 crediti che hai\.$/);
});

test('con la chiave propria: dollari e nessun avviso', () => {
  const v = S.valuta(A.FILO_CHAT, 'opus', REG, ctx({ modo: 'dollari', creditiPerDollaro: null }));
  assert.equal(v.modo, 'dollari');
  assert.match(v.breve, /^≈ [\d,]+ \$$/);
  assert.equal(v.avviso, '');
});

test('voce e dettatura si pagano a durata: cifra solo dopo un uso con quel modello', () => {
  const reg = { kokoro: { provider: 'openrouter', model: 'hexgrad/kokoro-82m' } };
  const prima = S.valuta(A.TTS, 'kokoro', reg, ctx());
  assert.equal(prima.ok, false);
  assert.equal(prima.breve, 'costo da misurare');
  const registro = S.aggiungiCampione({}, A.TTS, { usd: 0.002, model: 'hexgrad/kokoro-82m' });
  const dopo = S.valuta(A.TTS, 'kokoro', reg, ctx({ registro }));
  assert.equal(dopo.ok, true);
  assert.equal(dopo.fonte, 'misura');
  assert.match(dopo.perUso, /per lettura$/);
});

test('il registro d\'uso è una media mobile sugli ultimi usi, non una somma che cresce', () => {
  let r = {};
  for (let i = 0; i < 200; i++) r = S.aggiungiCampione(r, A.EXPLAIN, { prompt: 1000, completion: 100 });
  for (let i = 0; i < 200; i++) r = S.aggiungiCampione(r, A.EXPLAIN, { prompt: 3000, completion: 300 });
  assert.equal(r[A.EXPLAIN].n, S.FINESTRA);
  assert.ok(r[A.EXPLAIN].prompt > 2900 && r[A.EXPLAIN].prompt <= 3000);
  // Una chiamata senza token (un costo arrivato dopo) non sposta la media.
  r = S.aggiungiCampione(r, A.EXPLAIN, { usd: 0.01 });
  assert.ok(r[A.EXPLAIN].prompt > 2900);
});

test('un id grezzo di OpenRouter vale come modello; un nome che non c\'è no', () => {
  assert.deepEqual(S.voceDi('anthropic/claude-opus-4.5', {}), { provider: 'openrouter', model: 'anthropic/claude-opus-4.5' });
  assert.equal(S.voceDi('opus', {}), null);
  assert.equal(S.valuta(A.FILO_CHAT, 'opus', {}, ctx()), null);
});

test('la soglia: 5 di partenza, 0 spegne, un valore storto torna a 5', () => {
  assert.equal(S.soglia({}), 5);
  assert.equal(S.soglia({ costoModelli: { soglia: 0 } }), 0);
  assert.equal(S.soglia({ costoModelli: { soglia: 12 } }), 12);
  assert.equal(S.soglia({ costoModelli: { soglia: -3 } }), 5);
  assert.equal(S.soglia({ costoModelli: { soglia: 1e9 } }), S.SOGLIA_MAX);
});

test('la tariffa delle stime è la stessa che scala il saldo', () => {
  const p = { eurPerCredit: 0.0008, eurUsd: 1.08 };
  assert.equal(W.creditsForUsd(1, p), Math.ceil(W.creditsPerUsd(p) * 10 - 1e-6) / 10);
});

test('chat: «Chat con Filo: opus» cambia il modello di quella funzione sola, e la soglia si cambia a parole', () => {
  const b = P.buildPreferencePartial('modello_funzione', 'Chat con Filo: opus, deepseek');
  assert.deepEqual(b.partial, { models: { [A.FILO_CHAT]: 'opus, deepseek' } });
  assert.deepEqual(b.modelloFunzione.refs, ['opus', 'deepseek']);
  // Un id di OpenRouter può avere i due punti.
  const raw = P.buildPreferencePartial('modello_funzione', 'chat: deepseek/deepseek-v4:free');
  assert.deepEqual(raw.partial, { models: { [A.FILO_CHAT]: 'deepseek/deepseek-v4:free' } });
  // Una funzione che non c'è: rifiuto, e al modello l'elenco dei nomi giusti.
  const no = P.buildPreferencePartial('modello_funzione', 'Calcolatrice: opus');
  assert.ok(no.rifiuto);
  assert.match(no.perModello, /chat con Filo/);
  assert.deepEqual(P.buildPreferencePartial('avviso_modelli_costosi', 'mai').partial, { costoModelli: { soglia: 0 } });
  assert.deepEqual(P.buildPreferencePartial('avviso modelli costosi', '10').partial, { costoModelli: { soglia: 10 } });
});

test('registro d\'uso: le chiamate di un messaggio in chat (giri di strumenti) fanno un campione solo', async () => {
  const backing = {};
  globalThis.chrome = { storage: { local: {
    async get(key) { return { [key]: backing[key] }; },
    async set(obj) { Object.assign(backing, obj); },
  } } };
  require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));
  require(join(ROOT, 'src', 'main', 'services', 'costTracker.js'));
  const Costs = globalThis.SN_COSTS;
  const giro = (p, c) => Costs.record({ action: A.FILO_CHAT, provider: 'openrouter', model: 'm', usage: { promptTokens: p, completionTokens: c } });
  await Costs.unUso(A.FILO_CHAT, async () => { await giro(5000, 100); await giro(6000, 300); });
  let reg = await Costs.registroToken();
  assert.equal(reg[A.FILO_CHAT].n, 1);
  assert.equal(reg[A.FILO_CHAT].prompt, 11000);
  assert.equal(reg[A.FILO_CHAT].completion, 400);
  // Fuori da un uso, ogni chiamata è un campione.
  await Costs.record({ action: A.EXPLAIN, provider: 'openrouter', model: 'm', usage: { promptTokens: 800, completionTokens: 90 } });
  reg = await Costs.registroToken();
  assert.equal(reg[A.EXPLAIN].n, 1);
  assert.equal(reg[A.FILO_CHAT].n, 1);
});
