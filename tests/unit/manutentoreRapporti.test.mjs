// `npm run manutentore -- rapporti` (#2083): il costo di un feedback e di una finestra chiesto al server, le pagine col
// cursore, il conto per area dalle schede locali, la cache per ruolo (#2121). La rete è finta (fetch sostituito); il server vero ha le sue prove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const M = await import('../../scripts/manutentore.mjs');
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHIAVE = { env: { FILO_MANUTENTORE_KEY: 'chiave-di-prova' }, root: RADICE };
const NOW = Date.parse('2026-11-04T12:00:00Z');

function serverFinto(t, risposte) {
  const corpi = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    corpi.push(b);
    const r = typeof risposte[b.op] === 'function' ? risposte[b.op](b, corpi) : risposte[b.op];
    const [status, body] = r || [400, { ok: false, reason: 'malformed', detail: `op ${b.op}` }];
    return { status, ok: status < 300, text: async () => JSON.stringify(body) };
  };
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => err.push(a.join(' '));
  t.after(() => { globalThis.fetch = prima; console.log = l; console.error = e; });
  return { corpi, out, err };
}

test('la richiesta: numero, sotto-numeri, finestra per date o per giorni, pagine', () => {
  assert.deepEqual(M.richiestaRapporti(['rapporti'], NOW), { ok: true, dati: {}, tutte: false, cache: false, json: false });
  assert.deepEqual(M.richiestaRapporti(['rapporti', '#1790', '--sottonumeri', '--somma'], NOW).dati, { numero: '1790', sottonumeri: true, somma: true });
  assert.deepEqual(M.richiestaRapporti(['rapporti', '--giorni', '7', '--somma'], NOW).dati, { da: '2026-10-28T12:00:00.000Z', somma: true });
  assert.deepEqual(M.richiestaRapporti(['rapporti', '--giorni=2', '--a', '2026-11-01'], NOW).dati, { da: '2026-10-30T00:00:00.000Z', a: '2026-11-01' });
  assert.deepEqual(M.richiestaRapporti(['rapporti', '--da', '2026-10-28', '--a', '2026-11-04T08:00Z', '--limite', '200', '--cursore', 'ab12', '--tutte'], NOW),
    { ok: true, dati: { da: '2026-10-28', a: '2026-11-04T08:00Z', cursore: 'ab12', limite: 200 }, tutte: true, cache: false, json: false });
});

test('le richieste storte si fermano prima del server, col perché', async (t) => {
  const storte = [
    [['rapporti', 'boh'], /non è un numero/],
    [['rapporti', '812', '815'], /di troppo/],
    [['rapporti', '--da', 'ieri'], /non è una data/],
    [['rapporti', '--a', '2026-11-01'], /--a vuole l'inizio/],
    [['rapporti', '--da', '2026-11-01', '--giorni', '7'], /o --da o --giorni/],
    [['rapporti', '--giorni', '0'], /da 1 in su/],
    [['rapporti', '--limite', '0'], /da 1 in su/],
    [['rapporti', '--sottonumeri'], /vuole il numero/],
    [['rapporti', '--somma', '--tutte'], /--tutte non serve/],
  ];
  for (const [argv, motivo] of storte) assert.match(M.controlliLocali('rapporti', argv), motivo, argv.join(' '));
  assert.equal(M.controlliLocali('rapporti', ['rapporti', '1790', '--sottonumeri']), '');
  const s = serverFinto(t, {});
  assert.equal(await M.main(['rapporti', '--limite', '0'], CHIAVE), 1);
  assert.deepEqual(s.corpi, [], 'il server non è stato chiamato');
});

test('il tetto della pagina lo decide il server: una pagina più grande arriva a lui, e il suo rifiuto col numero torna com è', async (t) => {
  assert.deepEqual(M.richiestaRapporti(['rapporti', '--limite', '500'], NOW).dati, { limite: 500 });
  assert.equal(M.controlliLocali('rapporti', ['rapporti', '--limite', '500', '--cursore', 'x.y']), '');
  const s = serverFinto(t, { rapporti: () => [200, { ok: false, reason: 'malformed', detail: 'limite è un intero da 1 a 200 (chiesto 500)' }] });
  assert.equal(await M.main(['rapporti', '--limite', '500'], CHIAVE), 4);
  assert.deepEqual(s.corpi.map((c) => c.dati), [{ limite: 500 }]);
  assert.match(s.err.join('\n'), /da 1 a 200 \(chiesto 500\)/);
});

test('il conto di una settimana per area, per ruolo e per numero, con le aree delle schede locali', async (t) => {
  const schede = cartellaTemporanea('filo-schede-costi-');
  writeFileSync(join(schede, '1790.json'), JSON.stringify({ numero: '1790', area: 'routine-strumenti', titolo_breve: 'x' }));
  writeFileSync(join(schede, '2001.json'), JSON.stringify({ numero: '2001', area: 'browser-schede', titolo_breve: 'y' }));
  const risposta = {
    ok: true, finestra: { daMs: NOW - 7 * 864e5, aMs: NOW, da: '2026-10-28T12:00:00.000Z', a: '2026-11-04T12:00:00.000Z' },
    costo: { usd: 160.5, biglietti: 13, conRapporto: 12 },
    perNumero: [
      { num: '#1790', usd: 79.5, biglietti: 7, conRapporto: 6 }, { num: '#2001', usd: 40, biglietti: 3, conRapporto: 3 },
      { num: 'cmp-1', usd: 31, biglietti: 2, conRapporto: 2 }, { num: '#1999', usd: 10, biglietti: 1, conRapporto: 1 },
    ],
    perRuolo: [{ ruolo: 'resolver', usd: 120, biglietti: 8, conRapporto: 8 }, { ruolo: 'compito', usd: 40.5, biglietti: 5, conRapporto: 4 }],
  };
  const s = serverFinto(t, { rapporti: [200, risposta] });
  assert.equal(await M.main(['rapporti', '--giorni', '7', '--somma', '--cartella', schede], CHIAVE), 0);
  assert.equal(s.corpi[0].op, 'rapporti');
  assert.equal(s.corpi[0].dati.somma, true);
  assert.ok(Date.parse(s.corpi[0].dati.da) > 0);
  const testo = s.out.join('\n');
  assert.match(testo, /^Finestra dal 2026-10-28T12:00:00\.000Z al 2026-11-04T12:00:00\.000Z: 160\.50 \$ su 13 biglietti \(12 col rapporto\)/);
  assert.match(testo, /Per area:\n {2}routine-strumenti: 79\.50 \$ su 7 biglietti[^\n]*\n {2}browser-schede: 40\.00 \$[^\n]*\n {2}\(senza feedback[^\n]*: 31\.00 \$[^\n]*\n {2}\?: 10\.00 \$/);
  assert.match(testo, /Per ruolo:\n {2}resolver: 120\.00 \$/);
  assert.match(testo, /#1790 \[routine-strumenti\]: 79\.50 \$ su 7 biglietti \(6 col rapporto\)/);
});

test('oltre le righe per numero la somma dice quanti ne restano e quanto valgono', () => {
  const perNumero = Array.from({ length: M.COSTO_RIGHE_MAX + 3 }, (_, i) => ({ num: `#${100 + i}`, usd: 1, biglietti: 1, conRapporto: 1 }));
  const righe = M.righeCosto({ costo: { usd: perNumero.length, biglietti: perNumero.length, conRapporto: perNumero.length }, perNumero });
  assert.equal(righe.at(-1), '  e altri 3 numeri per 3.00 $: --json per l\'elenco intero');
  assert.match(righe.join('\n'), /Per area \(nessuna scheda locale: tutto in «\?»\):/);
});

test('un feedback a pagine: --tutte segue il cursore fino all ultima e stampa tutto, col conto', async (t) => {
  const pagine = {
    '': { ok: true, numero: '#1790', costo: { usd: 79.5, biglietti: 3, conRapporto: 3 }, rapporti: [{ ticket: 'c' }, { ticket: 'b' }], cursore: 'b' },
    b: { ok: true, numero: '#1790', costo: { usd: 79.5, biglietti: 3, conRapporto: 3 }, rapporti: [{ ticket: 'a' }], cursore: null },
  };
  const s = serverFinto(t, { rapporti: (b) => [200, pagine[b.dati.cursore || '']] });
  assert.equal(await M.main(['rapporti', '1790', '--limite', '2', '--tutte'], CHIAVE), 0);
  assert.deepEqual(s.corpi.map((c) => c.dati), [{ numero: '1790', limite: 2 }, { numero: '1790', limite: 2, cursore: 'b' }]);
  const stampato = JSON.parse(s.out.join('\n'));
  assert.deepEqual(stampato.rapporti.map((r) => r.ticket), ['c', 'b', 'a']);
  assert.deepEqual(stampato.costo, { usd: 79.5, biglietti: 3, conRapporto: 3 });
  assert.equal(stampato.pagine, 2);
  assert.equal(stampato.cursore, null);
});

test('un rifiuto del server a metà delle pagine arriva com è, e un cursore che non finisce si ferma col numero', async () => {
  const rifiuto = await M.tutteLePagine(async (d) => (d.cursore ? { ok: false, reason: 'malformed', detail: 'cursore' } : { ok: true, rapporti: [{}], cursore: 'x' }), {});
  assert.deepEqual(rifiuto, { ok: false, reason: 'malformed', detail: 'cursore' });
  const giro = await M.tutteLePagine(async () => ({ ok: true, rapporti: [], cursore: 'sempre' }), {});
  assert.equal(giro.reason, 'troppe_pagine');
  assert.match(giro.detail, new RegExp(`oltre ${M.RAPPORTI_PAGINE_MAX} pagine`));
});

// #2121: la misura della cache dei sotto-agenti deve costare un comando, perché il confronto si rifà ogni settimana.
const BIGLIETTI_CACHE = [
  {
    ticket: 'v1', ruolo: 'verifier', attese: [{ cosa: 'Bash: unit', secondi: 424 }, { cosa: 'Bash: x', secondi: 299 }, { cosa: 'Bash: y', secondi: 300 }],
    report: { role: 'verifier', models: ['claude-opus-5-5'], costUsd: 20, turns: 50, rewarmTurns: 2, rewarmTokens: 100000, tokens: { cacheWrite: 1000000 } },
  },
  { ticket: 'v2', ruolo: 'verifier', attese: [{ cosa: 'Bash: suite', secondi: 600 }] },
  { ticket: 'm1', report: { role: 'manutentore', models: ['claude-fable-5-1'], costUsd: 4, turns: 10, rewarmTurns: 0, rewarmTokens: 0, tokens: { cacheWrite: 100000 } } },
];

test('rapporti --cache: per ruolo la cache scritta, i rewarm, le attese oltre i 5 minuti e il saldo dell ora ai prezzi del listino', () => {
  const c = M.contoCache(BIGLIETTI_CACHE);
  const v = c.perRuolo.find((g) => g.ruolo === 'verifier');
  const m = c.perRuolo.find((g) => g.ruolo === 'manutentore');
  assert.deepEqual(c.perRuolo.map((g) => g.ruolo), ['verifier', 'manutentore']);
  assert.equal(v.biglietti, 2);
  assert.equal(v.conRapporto, 1);
  // Le attese dal biglietto, da 300 s in su: anche quelle di un biglietto senza rapporto.
  assert.equal(v.attese, 3);
  assert.equal(v.bigliettiConAttese, 2);
  // Opus 5.5: scrittura 5 $/M, a un'ora 8 $/M, lettura 0,2 $/M.
  const vicino = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} contro ${b}`);
  vicino(v.cacheUsd, 5); vicino(v.sovrapprezzo, 3); vicino(v.risparmioMax, 0.48); vicino(v.saldo, -2.52); vicino(v.soglia, 0.625);
  vicino(v.rewarmUsd, 0.5);
  // Fable 5.1: 12,5 → 20 $/M, il ruolo letto dal rapporto quando il biglietto non lo porta.
  vicino(m.cacheUsd, 1.25); vicino(m.sovrapprezzo, 0.75); vicino(m.risparmioMax, 0);
  assert.equal(c.totale.biglietti, 3);
  vicino(c.totale.usd, 24); vicino(c.totale.saldo, 0.48 - 3.75);
});

test('rapporti --cache legge tutte le pagine della finestra e stampa una riga per ruolo col totale; --json dà i numeri', async (t) => {
  assert.equal(M.richiestaRapporti(['rapporti', '--giorni', '7', '--cache'], NOW).tutte, true);
  assert.match(M.controlliLocali('rapporti', ['rapporti', '--cache', '--somma']), /--cache le legge tutte/);
  assert.match(M.controlliLocali('rapporti', ['rapporti', '--cache', '--cursore', 'x']), /il cursore non serve/);
  const finestra = { da: '2026-10-28T12:00:00.000Z', a: '2026-11-04T12:00:00.000Z' };
  const pagine = {
    '': { ok: true, finestra, rapporti: BIGLIETTI_CACHE.slice(0, 2), cursore: 'p2' },
    p2: { ok: true, finestra, rapporti: BIGLIETTI_CACHE.slice(2), cursore: null },
  };
  const s = serverFinto(t, { rapporti: (b) => [200, pagine[b.dati.cursore || '']] });
  assert.equal(await M.main(['rapporti', '--giorni', '7', '--cache'], CHIAVE), 0);
  assert.equal(s.corpi.length, 2);
  assert.equal(s.corpi[0].dati.somma, undefined);
  const testo = s.out.join('\n');
  assert.match(testo, /^Cache dei sotto-agenti dal 2026-10-28T12:00:00\.000Z al 2026-11-04T12:00:00\.000Z/);
  assert.match(testo, /\n {2}verifier: 2 biglietti \(1 col rapporto\) · 20\.00 \$ · cache scritta 1\.00 M tok = 5\.00 \$ \(25\.0 % del costo\) · rewarm 2 su 50 turni, 0\.10 M tok = 0\.50 \$ \(10\.0 % della cache scritta\) · attese ≥300 s: 3 su 2 biglietti · ora: sovrapprezzo 3\.00 \$, risparmio max 0\.48 \$, saldo −2\.52 \$ \(conviene sopra il 62\.5 % di rewarm\)/);
  assert.match(testo, /\n {2}manutentore: 1 biglietti/);
  assert.match(testo, /\n {2}TOTALE: 3 biglietti \(2 col rapporto\) · 24\.00 \$[^\n]*saldo −3\.27 \$/);

  const j = serverFinto(t, { rapporti: (b) => [200, pagine[b.dati.cursore || '']] });
  assert.equal(await M.main(['rapporti', '--giorni', '7', '--cache', '--json'], CHIAVE), 0);
  const o = JSON.parse(j.out.join('\n'));
  assert.deepEqual(o.finestra, finestra);
  assert.equal(o.totale.biglietti, 3);
  assert.equal(o.perRuolo[0].ruolo, 'verifier');
});

test('rapporti --cache: i dollari scritti dal rapporto vincono sulla stima al primo modello, e i rapporti stimati si contano', () => {
  const cache = { scrittaUsd: 2, rewarmUsd: 0.4, sovrapprezzoOraUsd: 1.1, risparmioOraUsd: 0.3, risparmioSeTuttoUsd: 1.9 };
  const c = M.contoCache([
    // Opus col sotto-agente Haiku: la stima al primo modello direbbe 5 $ di cache scritta.
    { ruolo: 'verifier', report: { role: 'verifier', models: ['claude-opus-5-5', 'claude-haiku-5-5'], costUsd: 10, turns: 9, rewarmTokens: 100000, tokens: { cacheWrite: 1000000 }, cache } },
    ...BIGLIETTI_CACHE,
  ]);
  const v = c.perRuolo.find((g) => g.ruolo === 'verifier');
  const vicino = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} contro ${b}`);
  vicino(v.cacheUsd, 2 + 5); vicino(v.rewarmUsd, 0.4 + 0.5); vicino(v.sovrapprezzo, 1.1 + 3); vicino(v.risparmioMax, 0.3 + 0.48);
  assert.equal(v.stimati, 1);
  assert.equal(c.totale.stimati, 2);
  assert.match(M.righeCache(c).join('\n'), /\n2 rapporti senza i dollari della cache/);
  assert.doesNotMatch(M.righeCache(M.contoCache([{ report: { cache, tokens: {} } }])).join('\n'), /senza i dollari/);
});
