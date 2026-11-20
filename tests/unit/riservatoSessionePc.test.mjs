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

test('#2027.3: col server giù il segno resta annotato, parte alla chiamata dopo, e intanto il biglietto non va con le scritture', async () => {
  await conBiglietto(async ({ env, cwd }) => {
    const giu = localTicket({ rompi: true });
    const r = await B.segnaRiservato('letto #813', { env, cwd, deps: giu.deps });
    assert.equal(r.segnati, 0);
    assert.equal(r.inAttesa, 1);
    const [b] = B.trovaBiglietti({ env, cwd });
    assert.deepEqual(B.riservatiInAttesa(b).map((v) => v.motivo), ['letto #813']);
    assert.match(await B.rigaRiservato('letto #814', { env, cwd, deps: giu.deps }), /annotato in locale e parte alla prossima chiamata.*nascono riservati/);
    // Ancora giù: compiti e domande partono senza biglietto, e il server li fa riservati.
    assert.equal(await B.segretoPerScrivere({ env, cwd, deps: giu.deps }), '');
    assert.equal((await B.trovaBiglietto({ env, cwd, deps: giu.deps })).riservatoInAttesa, 2);

    // Il server torna: la prima chiamata consegna il segno, poi il biglietto scrive di nuovo col suo nome.
    const su = localTicket();
    assert.equal(await B.segretoPerScrivere({ env, cwd, deps: su.deps }), SEGRETO);
    const riservato = su.chiamate.find((c) => c.op === 'riservato');
    assert.ok(riservato, JSON.stringify(su.chiamate));
    assert.match(riservato.motivo, /letto #813; letto #814/);
    assert.ok(su.chiamate.indexOf(riservato) < su.chiamate.findIndex((c) => c.op === 'stato'), 'il segno parte prima di leggere lo stato');
    assert.deepEqual(B.riservatiInAttesa(b), []);
  });
});

test('#2027.3: senza biglietto leggere dati privati lo dice, come per lo sporco', async () => {
  const fuori = cartellaTemporanea('senza-');
  try {
    const riga = await B.rigaRiservato('letto #813', { env: {}, cwd: fuori, deps: localTicket().deps });
    assert.match(riga, /Nessun biglietto trovato da qui.*nascono riservati/);
    const righe = await dichiaraLettura({ numero: '813', motivi: [] }, { riserva: (cosa) => B.rigaRiservato(cosa, { env: {}, cwd: fuori }) });
    assert.equal(righe.length, 1);
    assert.match(righe[0], /node scripts\/biglietto\.mjs riservato "letto #813"/);
  } finally {
    togliCartella(fuori);
  }
});

test('#2027.3: domanda.mjs chiedi si dichiara sessione, così senza biglietto il server la fa riservata', async () => {
  const mandate = [];
  const domandaFile = JSON.stringify({ titolo: 'Una scelta', priorita: 'importante', problema: 'Due strade.', opzioni: [] });
  const io = {
    chiama: async (data) => { mandate.push(data); return { ok: true, id: 'D-5', fiducia: 'non_fidato' }; },
    biglietto: async () => '', credenziale: async () => ({ tipo: 'admin' }), bigliettoLocale: async () => '',
    leggiFile: () => domandaFile, sporca: async () => '', scrivi: () => {}, errore: () => {},
  };
  assert.equal(await domanda(['chiedi', 'd.json'], io), 0);
  assert.deepEqual([mandate[0].op, mandate[0].sessione, mandate[0].biglietto], ['chiedi', true, undefined]);
});

test('#2027.3: con la chiave del manutentore il biglietto della sessione va col corpo, perché il server segni le letture', () => {
  assert.deepEqual(manutentore.corpoManutentore({ passphrase: 'k' }, 'leggi', { numero: '813' }, { bigliettoLocale: SEGRETO }),
    { passphrase: 'k', op: 'leggi', dati: { numero: '813' }, bigliettoLocale: SEGRETO });
  assert.deepEqual(manutentore.corpoManutentore({ ticket: 't1' }, 'leggi', {}, { bigliettoLocale: SEGRETO }), { ticket: 't1', op: 'leggi', dati: {} },
    'col biglietto del manutentore il segno lo prende lui');
  assert.deepEqual(manutentore.corpoManutentore({ passphrase: 'k' }, 'stato'), { passphrase: 'k', op: 'stato', dati: {} });
});

test('#2027.3: le risposte alla domanda di fine sessione prendono sporco e segno riservato prima di uscire', async () => {
  const ordine = [];
  const testo = await leggiRisposte(5, {
    chiama: async (d) => { ordine.push(['chiama', d.op, d.limit]); return { answers: [] }; },
    sporca: async (cosa) => { ordine.push(['sporca', cosa]); return 'sporcato'; },
    riserva: async (cosa) => { ordine.push(['riserva', cosa]); return 'riga del segno'; },
    errore: (s) => ordine.push(['errore', s]),
  });
  assert.equal(typeof testo, 'string');
  assert.deepEqual(ordine.map((x) => x[0]), ['chiama', 'sporca', 'errore', 'riserva', 'errore']);
  assert.match(ordine[3][1], /risposte delle routine/);
  assert.equal(ordine[4][1], 'riga del segno');
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
