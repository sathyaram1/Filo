// #2027: la sessione del PC chiama il server col token dell'owner, quindi ogni sua lettura di dati privati porta il
// biglietto (domande, compiti) o lo dichiara (il feedback letto dal database), e il biglietto prende il segno riservato.
// Server finto: nessuna chiamata vera. Le regole del segno le prova il server (sessione-riservata-2027.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';
import { leggiArgomenti } from '../../scripts/biglietto.mjs';
import { dichiaraLettura } from '../../scripts/leggi-feedback.mjs';
import { esegui as domanda } from '../../scripts/domanda.mjs';
import { esegui as compito } from '../../scripts/compito.mjs';

const SEGRETO = 's'.repeat(43);

function localTicket({ rompi = false } = {}) {
  const chiamate = [];
  const fetchImpl = async (url, init) => {
    const { data } = JSON.parse(init.body);
    chiamate.push(data);
    if (rompi) throw new TypeError('fetch failed');
    const result = data.ticket === SEGRETO ? { ok: true, riservato: true } : { ok: false, reason: 'biglietto_sconosciuto' };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { chiamate, deps: { fetchImpl, idToken: async () => 'token-finto' } };
}

async function conBiglietto(fn) {
  const dir = cartellaTemporanea('riservato-');
  try {
    const p = join(dir, '.claude', 'biglietti', 'sessione.json');
    B.scriviFile(p, { ticket: SEGRETO, fp: 'f'.repeat(64), natoIl: 1 });
    return await fn({ env: { FILO_BIGLIETTO_FILE: p }, cwd: dir });
  } finally {
    togliCartella(dir);
  }
}

test('segnaRiservato manda il motivo al server col biglietto della sessione; senza biglietto non chiama', async () => {
  await conBiglietto(async ({ env, cwd }) => {
    const s = localTicket();
    const r = await B.segnaRiservato('letto #813', { env, cwd, deps: s.deps });
    assert.deepEqual(r, { segnati: 1, errori: [] });
    assert.deepEqual(s.chiamate, [{ op: 'riservato', ticket: SEGRETO, motivo: 'letto #813' }]);
    assert.equal(await B.rigaRiservato('letto #813', { env, cwd, deps: s.deps }), '', 'riuscito, niente da dire');
    // Server giù: la riga dice come dichiararlo a mano, prima di scrivere.
    const riga = await B.rigaRiservato('letto #813', { env, cwd, deps: localTicket({ rompi: true }).deps });
    assert.match(riga, /NON preso/);
    assert.match(riga, /node scripts\/biglietto\.mjs riservato "letto #813"/);
  });
  const vuoto = localTicket();
  const fuori = cartellaTemporanea('senza-');
  try {
    assert.deepEqual(await B.segnaRiservato('letto #813', { env: {}, cwd: fuori, deps: vuoto.deps }), { segnati: 0, errori: [], senzaBiglietto: true });
  } finally {
    togliCartella(fuori);
  }
  assert.equal(vuoto.chiamate.length, 0);
});

test('la riga di comando: riservato col motivo', () => {
  assert.deepEqual(leggiArgomenti(['riservato', 'letto', '#813']), { cmd: 'riservato', motivo: 'letto #813' });
  assert.ok(leggiArgomenti(['riservato']).errore);
  assert.ok(leggiArgomenti(['riservato', '  ']).errore);
});

test('il feedback letto dal database prende sempre il segno, anche fidato; non fidato si sporca anche', async () => {
  const fatto = [];
  const io = { sporca: async (cosa, motivi) => { fatto.push(['sporca', cosa, motivi]); return 'sporcato'; }, riserva: async (cosa) => { fatto.push(['riserva', cosa]); return ''; } };
  assert.deepEqual(await dichiaraLettura({ numero: '813', motivi: [] }, io), []);
  assert.deepEqual(fatto, [['riserva', 'letto #813']]);
  fatto.length = 0;
  assert.deepEqual(await dichiaraLettura({ numero: '814', motivi: ['feedback non fidato'] }, io), ['sporcato']);
  assert.deepEqual(fatto, [['sporca', 'letto #814', ['feedback non fidato']], ['riserva', 'letto #814']]);
});

test('le letture dello strumento delle domande portano il biglietto della sessione', async () => {
  const mandate = [];
  const chiama = async (data) => {
    mandate.push(data);
    if (data.op === 'mostra') return { domanda: { id: data.id, titolo: 'T', fiducia: 'fidato', opzioni: [] }, riferimenti: {} };
    if (data.op === 'elenco') return { domande: [] };
    return { voci: [] };
  };
  const io = { chiama, biglietto: async () => '', credenziale: async () => ({ tipo: 'admin' }), bigliettoLocale: async () => SEGRETO, sporca: async () => '', scrivi: () => {}, errore: () => {} };
  for (const argv of [['mostra', 'D-12'], ['elenco'], ['registro', 'crediti']]) assert.equal(await domanda(argv, io), 0, argv.join(' '));
  assert.deepEqual(mandate.map((d) => [d.op, d.biglietto]), [['mostra', SEGRETO], ['elenco', SEGRETO], ['registro', SEGRETO]]);
  // Senza biglietto la lettura parte come prima.
  mandate.length = 0;
  await domanda(['mostra', 'D-12'], Object.assign({}, io, { bigliettoLocale: async () => '' }));
  assert.equal(mandate[0].biglietto, undefined);
});

test('l’elenco dei compiti porta il biglietto, e la creazione dice se il compito è riservato', async () => {
  const mandate = [];
  const scritto = [];
  const io = {
    chiama: async (data) => { mandate.push(data); return data.op === 'elenco' ? { ok: true, aperti: [], storico: [] } : { ok: true, id: 'C-3', fiducia: 'non_fidato', riservato: true }; },
    bigliettoLocale: async () => SEGRETO, sporca: async () => '', scrivi: (s) => scritto.push(s), errore: () => {},
  };
  assert.equal(await compito(['elenco'], io), 0);
  assert.equal(mandate[0].biglietto, SEGRETO);
  assert.equal(await compito(['crea', '--titolo', 'Rimborso', '--istruzioni', 'Paga il conto.'], io), 0, scritto.join('\n'));
  assert.match(scritto.at(-1), /creato \(non fidato, riservato\)/);
});
