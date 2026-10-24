// L'avviso prima che i crediti finiscano (#818): ritmo, quota, soglie, riarmo, rimedi e scelte sopra i predefiniti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/modelCaps.js');
require('../../src/shared/wallet.js');
require('../fixtures/testModels.js');
require('../../src/shared/creditiAvviso.js');
const CA = globalThis.SN_CREDITI_AVVISO;
const A = globalThis.SN_CONST.ACTIONS;
const TM = globalThis.SN_TEST_MODELS;

const OGGI = '2026-10-15';
const mezzogiorno = new Date(2026, 9, 15, 12, 0, 0);

function diarioCon(giorni) {
  let d = {};
  for (const [giorno, righe] of Object.entries(giorni)) {
    for (const r of righe) d = CA.aggiungi(d, { giorno, ...r });
  }
  return d;
}

test('400 crediti, 300 al giorno, quota 100: finiscono dopodomani e l\'avviso scatta', () => {
  const diario = diarioCon({
    '2026-10-12': [{ azione: A.FILO_CHAT, crediti: 300 }],
    '2026-10-13': [{ azione: A.FILO_CHAT, crediti: 300 }],
    '2026-10-14': [{ azione: A.FILO_CHAT, crediti: 300 }],
    [OGGI]: [{ azione: A.FILO_CHAT, crediti: 100 }],
  });
  const r = CA.ritmo(diario, { oggi: OGGI });
  assert.equal(r.perGiorno, 300);
  const v = CA.valuta({ saldo: 400, perGiorno: r.perGiorno, quota: 100, ingresso: 2000 });
  assert.equal(v.scatta, true);
  assert.deepEqual(v.motivi, ['proiezione']);
  assert.equal(v.giorni, 2);
  // A qualunque ora del giorno: il netto è 200 al giorno, 400 durano due giorni.
  for (const ora of [0, 8, 12, 23]) {
    const adesso = new Date(2026, 9, 15, ora, 30, 0);
    assert.equal(CA.frase({ saldo: 400, giorni: v.giorni, motivi: v.motivi, adesso }), 'Ti restano 400 crediti: al ritmo di oggi finiscono dopodomani.');
  }
});

test('il ritmo: il primo giorno vale quello speso oggi, poi la media dei giorni interi, o oggi se è di più', () => {
  assert.equal(CA.ritmo({}, { oggi: OGGI }).perGiorno, 0);
  const soloOggi = diarioCon({ [OGGI]: [{ azione: A.EXPLAIN, crediti: 40 }] });
  assert.equal(CA.ritmo(soloOggi, { oggi: OGGI }).perGiorno, 40, 'non diviso per le ore passate');
  const due = diarioCon({ '2026-10-13': [{ azione: A.EXPLAIN, crediti: 90 }], [OGGI]: [{ azione: A.EXPLAIN, crediti: 10 }] });
  const r = CA.ritmo(due, { oggi: OGGI });
  assert.equal(r.giorniMedia, 2, 'ieri senza consumo conta come giorno a zero');
  assert.equal(r.perGiorno, 45);
  const oggiForte = diarioCon({ '2026-10-14': [{ azione: A.EXPLAIN, crediti: 50 }], [OGGI]: [{ azione: A.EXPLAIN, crediti: 120 }] });
  assert.equal(CA.ritmo(oggiForte, { oggi: OGGI }).perGiorno, 120);
  const lungo = diarioCon({
    '2026-10-08': [{ azione: A.EXPLAIN, crediti: 900 }],
    '2026-10-12': [{ azione: A.EXPLAIN, crediti: 30 }],
    '2026-10-13': [{ azione: A.EXPLAIN, crediti: 30 }],
    '2026-10-14': [{ azione: A.EXPLAIN, crediti: 30 }],
  });
  assert.equal(CA.ritmo(lungo, { oggi: OGGI }).perGiorno, 30, 'solo gli ultimi tre giorni interi');
});

test('il diario tiene due settimane e conta token e chiamate', () => {
  let d = CA.aggiungi({}, { giorno: '2026-09-20', azione: A.EXPLAIN, crediti: 5 });
  d = CA.aggiungi(d, { giorno: OGGI, azione: A.EXPLAIN, crediti: 1.5, prompt: 100, completion: 20 });
  d = CA.aggiungi(d, { giorno: OGGI, azione: A.EXPLAIN, tag: CA.ANTICIPATA, crediti: 2, prompt: 50, completion: 10 });
  d = CA.aggiungi(d, { giorno: OGGI, azione: A.EXPLAIN, crediti: 0.5, prompt: 10, completion: 2 });
  assert.equal(d['2026-09-20'], undefined, 'il giorno fuori finestra cade');
  assert.deepEqual(d[OGGI][A.EXPLAIN], { c: 2, p: 110, o: 22, n: 2 });
  assert.deepEqual(d[OGGI][`${A.EXPLAIN}#anticipata`], { c: 2, p: 50, o: 10, n: 1 });
});

test('sopra le soglie, o con l\'avviso spento, niente avviso; sotto il 10% dei crediti d\'ingresso sì', () => {
  assert.equal(CA.valuta({ saldo: 1500, perGiorno: 300, quota: 100, ingresso: 2000 }).scatta, false);
  assert.equal(CA.valuta({ saldo: 400, perGiorno: 300, quota: 100, ingresso: 2000, soglie: { attivo: false } }).scatta, false);
  const basso = CA.valuta({ saldo: 150, perGiorno: 50, quota: 100, ingresso: 2000 });
  assert.equal(basso.scatta, true);
  assert.deepEqual(basso.motivi, ['percento']);
  assert.equal(basso.giorni, Infinity);
  assert.match(CA.frase({ saldo: 150, giorni: basso.giorni, motivi: basso.motivi, adesso: mezzogiorno }), /meno del 10% .* la quota di ogni giorno basta/);
  // Soglie cambiate dalle preferenze.
  assert.equal(CA.valuta({ saldo: 400, perGiorno: 300, quota: 100, ingresso: 2000, soglie: { giorni: 1 } }).scatta, false);
  assert.equal(CA.valuta({ saldo: 900, perGiorno: 10, quota: 100, ingresso: 2000, soglie: { percento: 50 } }).scatta, true);
  // Senza crediti d'ingresso noti vale solo la proiezione.
  assert.equal(CA.valuta({ saldo: 50, perGiorno: 10, quota: 100, ingresso: 0 }).scatta, false);
});

test('nessun secondo avviso per lo stesso calo: la quota da sola non riarma, un saldo risalito sopra la soglia sì', () => {
  const v = CA.valuta({ saldo: 400, perGiorno: 300, quota: 100, ingresso: 2000 });
  const stato = { armato: false, sogliaRiarmo: CA.sogliaRiarmo({ sogliaSaldo: v.sogliaSaldo, quota: 100 }) };
  assert.equal(stato.sogliaRiarmo, 500);
  assert.equal(CA.riarmato(stato, 350), false);
  assert.equal(CA.riarmato(stato, 480), false, 'saldo più quota della notte: è lo stesso calo');
  assert.equal(CA.riarmato(stato, 1400), true, 'un regalo l\'ha riportato su');
  assert.equal(CA.riarmato(null, 0), true);
});

test('quando: oggi, domani, dopodomani, il giorno della settimana, poi i giorni', () => {
  assert.equal(CA.quando(0.2, mezzogiorno), 'oggi');
  assert.equal(CA.quando(1, mezzogiorno), 'domani');
  assert.equal(CA.quando(2, mezzogiorno), 'dopodomani');
  assert.equal(CA.quando(4, mezzogiorno), 'lunedì');
  assert.equal(CA.quando(10, mezzogiorno), 'fra 10 giorni');
  assert.equal(CA.quando(Infinity, mezzogiorno), null);
  assert.equal(CA.frase({ saldo: 0, giorni: 0 }), 'I crediti di Filo sono finiti.');
});

test('la prossima quota è un giorno dopo l\'ultima arrivata', () => {
  const grants = [{ why: 'entry', at: '2026-10-01T10:00:00.000Z', credits: 2000 }, { why: 'daily', at: new Date(2026, 9, 15, 2, 0, 0).toISOString(), credits: 100 }];
  const q = CA.prossimaQuota(grants, mezzogiorno);
  assert.equal(q.quando, 'stanotte verso le 2:00');
  assert.equal(CA.prossimaQuota([], mezzogiorno), null);
});

const config = (models = TM.models, extra = {}) => ({
  models, registry: TM.registry,
  prezzoDi: (id) => globalThis.SN_CONST.notionalPricingFor(id),
  ...extra,
});

test('modello più economico: la chat (strumenti) prende solo una riserva della sua catena, le immagini solo chi le legge', () => {
  const chat = CA.modelloPiuEconomico(A.FILO_CHAT, { p: 5000, o: 500 }, config());
  assert.equal(chat.nick, 'gemma', 'gemma è la riserva della chat e costa meno di DeepSeek V4 Pro');
  assert.equal(chat.catena, 'gemma, deepseek', 'il modello di prima resta come riserva');
  assert.ok(chat.rapporto < 0.5);
  // Senza riserve più economiche nella catena, la chat non cambia: deepseek-flash non ha mai fatto da chat.
  assert.equal(CA.modelloPiuEconomico(A.FILO_CHAT, { p: 5000, o: 500 }, config({ ...TM.models, [A.FILO_CHAT]: 'deepseek' })), null);
  // Descrivere un'immagine: solo un modello che le legge, dichiarato.
  const img = CA.modelloPiuEconomico(A.DESCRIBE_IMAGE, { p: 3000, o: 200 }, config({ ...TM.models, [A.DESCRIBE_IMAGE]: 'claude' }));
  assert.equal(img.nick, 'gemma-lite', 'il più economico fra quelli che leggono le immagini; DeepSeek Flash costa meno ma non le legge');
  const ignoto = { ...TM.registry, misterioso: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', label: 'Senza capacità dichiarate' } };
  const soloIgnoto = CA.modelloPiuEconomico(A.DESCRIBE_IMAGE, { p: 3000, o: 200 }, { ...config({ [A.DESCRIBE_IMAGE]: 'claude', [A.EXPLAIN]: 'misterioso' }), registry: ignoto });
  assert.equal(soloIgnoto, null, 'chi non dichiara di leggere le immagini non si propone per le immagini');
  // Testo semplice: il più economico fra quelli in uso, prima la riserva della catena.
  const sp = CA.modelloPiuEconomico(A.EXPLAIN, { p: 800, o: 200 }, config());
  assert.equal(sp.nick, 'gemma-lite');
  // Solo pesi aperti: Claude non si propone, e nemmeno si cambia una funzione già sul più economico.
  const deep = CA.modelloPiuEconomico(A.EXPLAIN_DEEP, { p: 1000, o: 500 }, config(TM.models, { soloPesiAperti: true }));
  assert.ok(deep && TM.registry[deep.nick].weights === 'open');
  assert.equal(CA.modelloPiuEconomico(A.EXPLAIN, { p: 800, o: 200 }, config({ ...TM.models, [A.EXPLAIN]: 'gemma-lite' })), null);
  // Prezzo ignoto: nessuna cifra inventata.
  assert.equal(CA.modelloPiuEconomico(A.FILO_CHAT, { p: 1, o: 1 }, config(TM.models, { prezzoDi: () => null })), null);
});

test('i rimedi: modelli più economici per le funzioni che consumano, automatiche accese che consumano, chiave, quota', () => {
  const diario = diarioCon({
    '2026-10-14': [
      { azione: A.FILO_CHAT, crediti: 200, prompt: 200000, completion: 20000 },
      { azione: A.EXPLAIN, tag: CA.ANTICIPATA, crediti: 40, prompt: 40000, completion: 8000 },
      { azione: A.FILO_TAB_SUMMARY, crediti: 30, prompt: 30000, completion: 3000 },
      { azione: A.SPELLCHECK_SEMANTIC, crediti: 30, prompt: 30000, completion: 3000 },
    ],
  });
  const impostazioni = { spiegaAnticipata: { enabled: true }, riassuntoSchede: { enabled: true }, featureFlags: { spellcheck: false, spellcheckContext: false, categorize: false }, correttore: { modelloErrori: false }, autoArchive: { enabled: true }, nomiSensati: { scaricamenti: false } };
  const lista = CA.rimedi({
    diario, oggi: OGGI, perGiorno: 300, quota: 100, prossima: { quando: 'stanotte verso le 2:00' },
    config: config(), impostazioni,
    etichetta: (a) => ({ [A.FILO_CHAT]: 'Chat con Filo', [A.EXPLAIN]: 'Spiega la selezione', [A.FILO_TAB_SUMMARY]: 'Riassunto di una scheda' }[a] || a),
    funzioni: globalThis.SN_CONST && Object.values(A),
  });
  const per = Object.fromEntries(lista.map((r) => [r.id, r]));
  assert.deepEqual(lista.map((r) => r.id), ['modello', 'automatiche', 'chiave', 'attesa']);
  assert.match(per.modello.testo, /Chat con Filo/);
  assert.ok(per.modello.cambi.some((c) => c.azione === A.FILO_CHAT && c.catena === 'gemma, deepseek'));
  assert.ok(per.modello.risparmio > 50 && per.modello.risparmio < 200, `risparmio della chat: ${per.modello.risparmio}`);
  assert.match(per.modello.frase, /^circa \d+ crediti in meno al giorno$/);
  // Il correttore è spento: non si propone di spegnerlo, e non conta nel risparmio.
  assert.deepEqual(per.automatiche.cambi.map((c) => c.percorso), ['spiegaAnticipata.enabled', 'riassuntoSchede.enabled']);
  // Media sui giorni interi: ieri, 70 crediti.
  assert.equal(Math.round(per.automatiche.risparmio), 70);
  assert.equal(per.chiave.frase, 'circa 300 crediti di Filo in meno al giorno');
  assert.equal(per.attesa.testo, 'Aspetta la quota del giorno: stanotte verso le 2:00 arrivano 100 crediti');
  // Con la chiave propria non c'è il rimedio della chiave; senza quota, niente attesa.
  const senza = CA.rimedi({ diario, oggi: OGGI, perGiorno: 300, quota: 0, chiavePropria: true, config: config(), impostazioni });
  assert.ok(!senza.some((r) => r.id === 'chiave' || r.id === 'attesa'));
});

test('pezzoPer costruisce il pezzo da salvare, leggiPercorso lo rilegge', () => {
  assert.deepEqual(CA.pezzoPer('riassuntoSchede.enabled', false), { riassuntoSchede: { enabled: false } });
  assert.equal(CA.leggiPercorso({ a: { b: true } }, 'a.b'), true);
  assert.equal(CA.leggiPercorso({}, 'a.b'), undefined);
});

test('i consumi per funzione: media dei giorni interi, e il primo giorno quello di oggi', () => {
  const soloOggi = diarioCon({ [OGGI]: [{ azione: A.FILO_CHAT, crediti: 40 }] });
  assert.equal(CA.consumoPerAzione(soloOggi, { oggi: OGGI })[A.FILO_CHAT].c, 40);
  const tre = diarioCon({
    '2026-10-12': [{ azione: A.FILO_CHAT, crediti: 30 }],
    '2026-10-14': [{ azione: A.FILO_CHAT, crediti: 60 }],
    [OGGI]: [{ azione: A.FILO_CHAT, crediti: 500 }],
  });
  assert.equal(CA.consumoPerAzione(tre, { oggi: OGGI })[A.FILO_CHAT].c, 30, 'tre giorni interi, uno a zero; oggi non conta');
});

test('spegnere la spiegazione preparata fa risparmiare solo quelle che nessuno ha aperto', () => {
  let d = {};
  for (let i = 0; i < 4; i++) d = CA.aggiungi(d, { giorno: '2026-10-14', azione: A.EXPLAIN, tag: CA.ANTICIPATA, crediti: 10, prompt: 100, completion: 10 });
  for (let i = 0; i < 3; i++) d = CA.aggiungiUso(d, { giorno: '2026-10-14', azione: A.EXPLAIN });
  const imp = { spiegaAnticipata: { enabled: true } };
  const r = CA.rimedi({ diario: d, oggi: OGGI, perGiorno: 40, quota: 0, chiavePropria: true, config: config(), impostazioni: imp });
  const auto = r.find((x) => x.id === 'automatiche');
  assert.equal(Math.round(auto.risparmio), 10, 'quattro preparate, tre aperte: si risparmia la quarta');
});

test('il sostituto legge quello che il modello di adesso legge: l\'Aiuto su un modello che vede non passa a uno che non vede', () => {
  const models = { ...TM.models, [A.HELP]: 'claude' };
  const m = CA.modelloPiuEconomico(A.HELP, { p: 5000, o: 500 }, config(models));
  assert.ok(m, 'un modello più economico che vede c\'è');
  const ins = globalThis.SN_CONST.entryModalities(TM.registry[m.nick], m.nick).input_modalities;
  assert.ok(ins.includes('image'), `${m.nick} non legge le immagini`);
});

test('la scelta di una funzione vale sopra i predefiniti solo coi modelli che esistono (anche un id grezzo)', () => {
  const C = globalThis.SN_CONST;
  const reg = { a: {}, b: {} };
  assert.deepEqual(C.effectiveModels({ x: 'a', y: 'b' }, { x: 'b, a', y: 'sparito' }, reg), { x: 'b, a', y: 'b' });
  assert.deepEqual(C.effectiveModels({ x: 'a' }, { x: 'b, google/gemma-x' }, reg), { x: 'b, google/gemma-x' });
  assert.deepEqual(C.effectiveModels({ x: 'a' }, { x: '' }, reg), { x: 'a' }, 'vuoto = nessuna scelta');
});

test('l\'avviso per il modello della chat porta la frase, i rimedi con le cifre e i dettagli; senza rimedi la frase sola', () => {
  const t = CA.perFilo('Ti restano 400 crediti: al ritmo di oggi finiscono dopodomani.', [
    { id: 'modello', testo: 'Usa modelli più economici per Chat con Filo', frase: 'circa 205 crediti in meno al giorno', dettagli: ['Chat con Filo: Gemma invece di DeepSeek'], azione: 'applica' },
    { id: 'attesa', testo: 'Aspetta la quota del giorno: stanotte arrivano 100 crediti', frase: '', azione: null },
    { id: 'vuoto', testo: '' },
  ]);
  assert.match(t, /^Ti restano 400 crediti/);
  assert.match(t, /- Usa modelli più economici per Chat con Filo \(circa 205 crediti in meno al giorno\)/);
  assert.match(t, /\n {2}Chat con Filo: Gemma invece di DeepSeek/);
  assert.match(t, /- Aspetta la quota del giorno/);
  assert.equal(CA.perFilo('Solo la frase.', []), 'Solo la frase.');
});

test('RIMEDIO_CREDITI: la chat applica e rimette i rimedi coi pulsanti, costo 1 come il clic', () => {
  require('../../src/shared/i18n.js');
  require('../../src/shared/actionLevels.js');
  require('../../src/shared/actionTools.js');
  const def = globalThis.SN_ACTION_TOOLS.definitions({ sistema: 'win32' }).find((d) => d.function.name === 'RIMEDIO_CREDITI');
  assert.ok(def, 'strumento RIMEDIO_CREDITI assente');
  const p = def.function.parameters.properties;
  assert.deepEqual(p.operazione.enum, ['applica', 'annulla', 'elenca']);
  assert.deepEqual(p.rimedio.enum, ['modello', 'automatiche']);
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.costoFor({ type: 'RIMEDIO_CREDITI', operazione: 'applica', rimedio: 'modello' }), 1);
  assert.match(L.describe({ type: 'RIMEDIO_CREDITI', operazione: 'annulla', rimedio: 'modello' }), /modelli di prima/);
});
