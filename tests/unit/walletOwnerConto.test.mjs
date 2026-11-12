// Chi usa Filo e se il conto OpenRouter regge (#820): i conti della pagina «Inviti e utenti» e dell'avviso all'owner
// all'avvio, in src/shared/wallet.js (logica pura). Le prove in Electron stanno in tests/wallet-owner-conto.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

const ORA = Date.parse('2026-10-15T10:00:00.000Z');
// Un credito vale 0,0007 € e un euro 1,2 $: un dollaro sono 1190,476… crediti.
const CFG = { eurPerCredit: 0.0007, eurUsd: 1.2 };

const persona = (pseudonym, giorni, usageUsd = 0) => ({
  pseudonym,
  balance: { usageUsd },
  usage: { rows: giorni.length, byDay: Object.fromEntries(giorni.map((g) => [g, 0.01])) },
});

test('attivi a 7 e 30 giorni: oggi e i sei giorni prima, oggi e i ventinove prima; un giorno a spesa zero conta', () => {
  const users = [
    persona('oggi', ['2026-10-15']),
    persona('sei-fa', ['2026-09-01', '2026-10-09']),
    persona('sette-fa', ['2026-10-08']),
    persona('ventinove-fa', ['2026-09-16']),
    persona('trenta-fa', ['2026-09-15']),
    { pseudonym: 'gratis', balance: { usageUsd: 0 }, usage: { rows: 1, byDay: { '2026-10-14': 0 } } },
    { pseudonym: 'mai', balance: { usageUsd: 0 }, usage: { rows: 0 } },
  ];
  const u = W.usoPersone(users, ORA);
  assert.deepEqual(u.attivi7.sort(), ['gratis', 'oggi', 'sei-fa']);
  assert.deepEqual(u.attivi30.sort(), ['gratis', 'oggi', 'sei-fa', 'sette-fa', 'ventinove-fa']);
  assert.equal(u.ultimo['sei-fa'], '2026-10-09', 'l’ultimo uso è il giorno più recente, non il primo della lista');
  assert.equal(u.ultimo.mai, null);
});

test('i giorni che non sono date non contano, e una tabella con chiavi strane non rompe il conto', () => {
  const byDay = Object.create(null);
  byDay.__proto__ = 3;
  byDay.constructor = 1;
  byDay['2026-10-15T00:00'] = 1;
  byDay['2026-10-01'] = 0.5;
  const u = W.usoPersone([{ pseudonym: 'x', balance: { usageUsd: 1 }, usage: { rows: 4, byDay } }, null, { pseudonym: 7 }], ORA);
  assert.equal(u.ultimo.x, '2026-10-01');
  assert.deepEqual(u.attivi7, []);
  assert.deepEqual(u.attivi30, ['x']);
});

test('i crediti spesi sono la somma della colonna «Speso»; una spesa non letta non vale zero', () => {
  const u = W.usoPersone([persona('a', [], 1.5), persona('b', [], 0.25), { pseudonym: 'c', balance: {} }], ORA);
  assert.equal(u.spesoUsd, 1.75);
  assert.equal(u.spesoIgnoti, 1);
  assert.equal(W.usoPersone([{ pseudonym: 'c', balance: {} }], ORA).spesoUsd, null, 'nessuna spesa letta: il totale non si conosce');
  assert.equal(W.usoPersone([], ORA).spesoUsd, 0, 'nessuna persona: zero vero');
});

test('euro e crediti al cambio del giorno; senza cambio null, mai un cambio inventato', () => {
  assert.equal(W.euroDaCrediti(10000, CFG), 7);
  assert.ok(Math.abs(W.creditiDaUsd(8.4, CFG) - 10000) < 1e-6);
  assert.ok(Math.abs(W.usdDaCrediti(10000, CFG) - 8.4) < 1e-9);
  assert.equal(W.euroDaUsd(12, CFG), 10);
  assert.equal(W.creditiDaUsd(8.4, { eurPerCredit: 0.0007 }), null);
  assert.equal(W.euroDaUsd(8.4, {}), null);
  assert.equal(W.euroDaCrediti(null, CFG), null);
});

const vista = (account, totals = {}) => ({ config: CFG, totals: { liveCredits: 10000, maxGrantUsd: 50, ...totals }, account });

test('il conto regge: caricato, speso, residuo in dollari e crediti, margine sui vivi, nessun allarme', () => {
  const c = W.contoOwner(vista({ totalCreditsUsd: 60, totalUsageUsd: 30, readAt: '2026-10-15T09:00:00.000Z' }));
  assert.equal(c.letto, true);
  assert.equal(c.restaUsd, 30);
  assert.ok(Math.abs(c.restaCrediti - 30 / 0.00084) < 1e-6);
  assert.ok(c.margine > 0);
  assert.deepEqual(c.allarmi, []);
});

test('sul conto restano meno dei crediti vivi: allarme che dice quanto resta e quanto hanno le persone', () => {
  const c = W.contoOwner(vista({ totalCreditsUsd: 60, totalUsageUsd: 55.8 }));
  assert.ok(Math.abs(c.restaUsd - 4.2) < 1e-9);
  assert.ok(c.margine < 0);
  assert.deepEqual(c.allarmi.map((a) => a.kind), ['vivi_oltre_conto']);
  assert.match(c.allarmi[0].testo, /restano 4,20 \$, cioè 5\.000 crediti, e le persone ne hanno 10\.000 da spendere/);
});

test('il tetto dei crediti da regalare supera quanto è stato caricato: allarme; tetto in crediti se manca quello in dollari', () => {
  const c = W.contoOwner(vista({ totalCreditsUsd: 40, totalUsageUsd: 1 }));
  assert.deepEqual(c.allarmi.map((a) => a.kind), ['tetto_oltre_caricato']);
  assert.match(c.allarmi[0].testo, /vale 50,00 \$, più dei 40,00 \$ caricati/);
  const inCrediti = W.contoOwner(vista({ totalCreditsUsd: 40, totalUsageUsd: 1 }, { maxGrantUsd: null, maxGrantCredits: 100000 }));
  assert.deepEqual(inCrediti.allarmi.map((a) => a.kind), ['tetto_oltre_caricato'], '100.000 crediti sono 84 $');
  assert.equal(W.contoOwner(vista({ totalCreditsUsd: 50, totalUsageUsd: 1 })).allarmi.length, 0, 'tetto uguale al caricato: regge');
});

test('conto non letto: niente numeri e niente allarmi, e si sa perché', () => {
  assert.deepEqual(W.contoOwner(vista(undefined)), { letto: false, motivo: 'assente', allarmi: [] });
  assert.deepEqual(W.contoOwner(vista({ error: 'openrouter 503' })), { letto: false, motivo: 'errore', allarmi: [] });
  assert.equal(W.contoOwner(vista({ totalCreditsUsd: 'tanti', totalUsageUsd: 1 })).letto, false);
  assert.equal(W.contoOwner(null).letto, false);
});

test('senza il cambio del giorno il margine non si conosce e non suona: il tetto in dollari sì', () => {
  const c = W.contoOwner({ config: {}, totals: { liveCredits: null, maxGrantUsd: 50 }, account: { totalCreditsUsd: 40, totalUsageUsd: 39 } });
  assert.equal(c.restaCrediti, null);
  assert.equal(c.margine, null);
  assert.deepEqual(c.allarmi.map((a) => a.kind), ['tetto_oltre_caricato']);
});

test('all’avvio un allarme si dice una volta finché resta, si ridice se torna, e un conto non letto non cambia niente', () => {
  const corto = W.contoOwner(vista({ totalCreditsUsd: 60, totalUsageUsd: 55.8 }));
  const sano = W.contoOwner(vista({ totalCreditsUsd: 60, totalUsageUsd: 1 }));
  const ignoto = W.contoOwner(vista(undefined));

  let r = W.allarmiDaDire([], corto);
  assert.deepEqual(r.dire.map((a) => a.kind), ['vivi_oltre_conto']);
  r = W.allarmiDaDire(r.detti, corto);
  assert.deepEqual(r.dire, [], 'stessa situazione: non si ripete');
  r = W.allarmiDaDire(r.detti, ignoto);
  assert.deepEqual(r.dire, []);
  assert.deepEqual(r.detti, ['vivi_oltre_conto'], 'conto non letto: quello già detto resta detto');
  r = W.allarmiDaDire(r.detti, sano);
  assert.deepEqual(r.detti, [], 'tornato a posto: si azzera');
  r = W.allarmiDaDire(r.detti, corto);
  assert.deepEqual(r.dire.map((a) => a.kind), ['vivi_oltre_conto'], 'torna corto: si ridice');

  const tutti = W.contoOwner(vista({ totalCreditsUsd: 40, totalUsageUsd: 39 }));
  r = W.allarmiDaDire(['vivi_oltre_conto'], tutti);
  assert.deepEqual(r.dire.map((a) => a.kind), ['tetto_oltre_caricato'], 'si dice solo quello nuovo');
  assert.deepEqual(W.allarmiDaDire('rotto', corto).dire.map((a) => a.kind), ['vivi_oltre_conto'], 'un deposito storto vale vuoto');
});
