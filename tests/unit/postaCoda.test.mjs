// Sentinella di src/shared/postaCoda.js (#535): la raffica di compiti all'accensione non supera il
// parallelo, ogni mail ha al massimo tre prove, e una caduta si vede nel contatore invece di sparire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'postaCoda.js'));
const C = globalThis.SN_POSTA_CODA;

const subito = () => Promise.resolve();
const mails = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, oggetto: `mail ${i + 1}` }));
const tick = () => new Promise((r) => setImmediate(r));

test('non più di N compiti insieme, e alla fine tutte lette', async () => {
  let ora = 0; let picco = 0;
  const coda = C.crea({
    parallelo: 3,
    attendi: subito,
    esegui: async () => { ora++; picco = Math.max(picco, ora); await tick(); ora--; return 'ok'; },
  });
  coda.aggiungi(mails(10));
  const s = await coda.finito();
  assert.equal(picco, 3);
  assert.equal(s.lette, 10);
  assert.equal(s.daLeggere, 0);
  assert.equal(s.fallite, 0);
  assert.equal(C.etichetta(s), 'posta: 10 lette');
  assert.equal(C.daMostrare(s), false);
});

test('il parallelo predefinito è 3 e uno strano torna al predefinito', async () => {
  assert.equal(C.PARALLELO, 3);
  for (const p of [undefined, 0, -2, 'tre', NaN]) {
    const coda = C.crea({ parallelo: p, esegui: async () => {} });
    assert.equal(coda.stato().parallelo, 3, String(p));
  }
});

test('una mail che cade due volte e poi riesce è letta; una che cade sempre si ferma alla terza prova', async () => {
  const prove = {};
  const coda = C.crea({
    attendi: subito,
    esegui: async (m, n) => {
      prove[m.id] = n;
      if (m.id === 'm1' && n < 3) throw new Error('rete');
      if (m.id === 'm2') throw new Error('il modello ha risposto male');
      return 'ok';
    },
  });
  coda.aggiungi(mails(3));
  const s = await coda.finito();
  assert.equal(prove.m1, 3);
  assert.equal(prove.m2, 3, 'tre prove in tutto: la prima più due riprove');
  assert.equal(s.lette, 2);
  assert.equal(s.fallite, 1);
  assert.deepEqual(s.nonLette.map((x) => x.id), ['m2']);
  assert.equal(s.nonLette[0].errore, 'il modello ha risposto male');
  assert.equal(C.etichetta(s), 'posta: 2 lette, 1 fallita');
  assert.equal(C.daMostrare(s), true, 'una mail non letta da Filo resta in vista anche a giro finito');
});

test('fra una prova e l\'altra si aspetta, e la mail in attesa conta fra quelle da leggere', async () => {
  const attese = [];
  let sblocca;
  const coda = C.crea({
    attendi: (ms) => { attese.push(ms); return new Promise((r) => { sblocca = r; }); },
    esegui: async (m, n) => { if (n === 1) throw new Error('rete'); return 'ok'; },
  });
  coda.aggiungi(mails(1));
  await tick(); await tick();
  const durante = coda.stato();
  assert.equal(durante.finito, false, 'una mail in pausa non chiude il giro');
  assert.equal(durante.daLeggere, 1);
  assert.equal(C.etichetta(durante), 'posta: 0 lette, 1 da leggere');
  sblocca();
  const s = await coda.finito();
  assert.equal(s.lette, 1);
  assert.deepEqual(attese, [C.ATTESE_MS[0]]);
});

test('troppe richieste: si abbassa il parallelo e la mail non perde tentativi', async () => {
  const prove = {};
  let colpi = 0;
  const coda = C.crea({
    parallelo: 3,
    attendi: subito,
    esegui: async (m, n) => {
      prove[m.id] = n;
      if (m.id === 'm1' && colpi < 4) { colpi++; const e = new Error('429'); e.status = 429; throw e; }
      return 'ok';
    },
  });
  coda.aggiungi(mails(4));
  const s = await coda.finito();
  assert.equal(s.lette, 4);
  assert.equal(s.fallite, 0);
  assert.equal(prove.m1, 1, 'le attese per troppe richieste non consumano tentativi');
  assert.equal(s.parallelo, 1);
});

test('crediti finiti: il giro si ferma col motivo, nessuna mail risulta fallita, e riparte da dov\'era', async () => {
  let senzaCrediti = true;
  const fatte = [];
  const coda = C.crea({
    parallelo: 1,
    attendi: subito,
    esegui: async (m) => {
      if (m.id === 'm2' && senzaCrediti) { const e = new Error('crediti finiti'); e.ferma = true; throw e; }
      fatte.push(m.id);
    },
  });
  coda.aggiungi(mails(4));
  let s = await coda.finito();
  assert.equal(s.fermata, 'crediti finiti');
  assert.equal(s.lette, 1);
  assert.equal(s.daLeggere, 3);
  assert.equal(s.fallite, 0);
  assert.match(C.etichetta(s), /fermo: crediti finiti/);
  assert.equal(C.daMostrare(s), true);
  senzaCrediti = false;
  coda.riparti();
  s = await coda.finito();
  assert.equal(s.lette, 4);
  assert.deepEqual(fatte, ['m1', 'm2', 'm3', 'm4']);
});

test('la stessa mail aggiunta di nuovo durante il giro non diventa un secondo compito', async () => {
  let chiamate = 0;
  const coda = C.crea({ attendi: subito, esegui: async () => { chiamate++; await tick(); } });
  assert.equal(coda.aggiungi(mails(3)), 3);
  assert.equal(coda.aggiungi([...mails(3), { id: 'm9' }, { id: '' }, null]), 1);
  await coda.finito();
  assert.equal(chiamate, 4);
});

test('una mail non letta da Filo si riprova a richiesta, con tutti i tentativi', async () => {
  let rotta = true;
  const coda = C.crea({ attendi: subito, esegui: async () => { if (rotta) throw new Error('no'); } });
  coda.aggiungi(mails(1));
  let s = await coda.finito();
  assert.equal(s.fallite, 1);
  rotta = false;
  assert.equal(coda.riprova('m1'), true);
  s = await coda.finito();
  assert.equal(s.fallite, 0);
  assert.equal(s.lette, 1);
  assert.equal(coda.riprova('m1'), false, 'una mail già letta non si riprova');
});

test('spenta, la coda finisce i compiti partiti e non ne lancia altri', async () => {
  const partite = [];
  const coda = C.crea({ parallelo: 2, attendi: subito, esegui: async (m) => { partite.push(m.id); await tick(); } });
  coda.aggiungi(mails(5));
  coda.spegni();
  const s = await coda.finito();
  assert.deepEqual(partite, ['m1', 'm2']);
  assert.equal(s.lette, 2);
  assert.equal(s.daLeggere, 3);
});

test('ogni cambiamento arriva a chi mostra il contatore', async () => {
  const visti = [];
  const coda = C.crea({ attendi: subito, esegui: async () => tick(), aggiornato: (s) => visti.push(C.etichetta(s)) });
  coda.aggiungi(mails(2));
  await coda.finito();
  assert.ok(visti.includes('posta: 0 lette, 2 da leggere'));
  assert.equal(visti.at(-1), 'posta: 2 lette');
});

test('etichetta al singolare', () => {
  assert.equal(C.etichetta({ lette: 1, daLeggere: 1, fallite: 1 }), 'posta: 1 letta, 1 da leggere, 1 fallita');
  assert.equal(C.etichetta({ lette: 0, daLeggere: 0, fallite: 2 }), 'posta: 0 lette, 2 fallite');
});
