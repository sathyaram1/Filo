// Sentinella (#536): il magazzino delle notifiche RIFIUTA un avviso nato da
// roba scritta da altri se non porta il timbro del guardiano.
//
// È questa la porta unica: una superficie nuova che si dimentica del controllo
// non mostra testo non controllato, si rompe. Un promemoria in un commento
// invece si dimentica, e il costo del dimenticarlo lo paga chi legge l'avviso.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');

// Magazzino finto: le notifiche non hanno bisogno di Electron per essere
// scritte, e la regola che si prova sta prima della scrittura.
const dati = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return dati.has(key) ? { [key]: dati.get(key) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) dati.set(k, v); },
    },
  },
};

require(join(SHARED, 'contenutoEsterno.js'));
require(join(SHARED, 'constants.js'));
require(join(SHARED, 'fiducia.js'));
require(join(SHARED, 'guardianoStatico.js'));
require(join(SHARED, 'guardiano.js'));
require(join(SHARED, 'filoMemory.js'));
const Porta = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'guardianoAvvisi.js'));

const Mem = globalThis.SN_FILO_MEMORY;

describe('nessun avviso contaminato senza il timbro del guardiano', () => {
  beforeEach(() => dati.clear());

  for (const classe of ['messaggio', 'sito', 'classe-mai-vista']) {
    test(`«${classe}» senza timbro viene rifiutato`, async () => {
      await assert.rejects(
        () => Mem.addNotification({ kind: 'alert', text: 'la tua banca chiede…', classe }),
        /senza controllo/,
      );
      assert.deepEqual(await Mem.listNotifications(), [], 'e non resta niente scritto');
    });
  }

  test('un timbro finto non basta: serve un esito che il guardiano sa dare', async () => {
    await assert.rejects(
      () => Mem.addNotification({ text: 'x', classe: 'messaggio', guardiano: { esito: 'ok' } }),
      /senza controllo/,
    );
  });

  test('col timbro «passa» l\'avviso è visibile', async () => {
    const n = await Mem.addNotification({
      text: 'Tre mail nuove.', classe: 'messaggio', fonte: 'posta',
      guardiano: { esito: 'passa' },
    });
    assert.equal(n.stato, 'visibile');
    assert.equal(n.classe, 'messaggio');
  });

  test('col timbro «attesa» l\'avviso resta in coda, non sparisce', async () => {
    const n = await Mem.addNotification({
      text: 'Tre mail nuove.', classe: 'messaggio', guardiano: { esito: 'attesa' },
    });
    assert.equal(n.stato, 'attesa');
    const lista = await Mem.listNotifications();
    assert.equal(lista.length, 1, 'la coda non perde niente');
  });

  test('quello che scrive Filo di suo non ha bisogno di timbro', async () => {
    const n = await Mem.addNotification({ kind: 'alert', text: 'Aggiornamento pronto.' });
    assert.equal(n.stato, 'visibile');
    assert.equal(n.classe, 'filo');
  });

  test('il registro dei blocchi si riempie e si svuota', async () => {
    await Mem.addBloccoGuardiano({ fonte: 'x@y.it', motivo: 'sembrava…', regola: 'guardiano', anteprima: 'ciao' });
    assert.equal((await Mem.listBlocchiGuardiano()).length, 1);
    await Mem.clearBlocchiGuardiano();
    assert.deepEqual(await Mem.listBlocchiGuardiano(), []);
  });
});

describe('un giro di posta propone più avvisi insieme', () => {
  beforeEach(() => dati.clear());

  test('nessuno si perde: chi riscrive tutta la lista scrive in fila', async () => {
    Porta.configure({
      async getSettings() {
        return { models: { [globalThis.SN_CONST.ACTIONS.NOTICE_GUARD]: 'guardia' } };
      },
      modelForAction: (s, a) => s.models[a],
      async runOneShot() { return '{"passa":true,"motivo":null}'; },
    });
    const esiti = await Promise.all([1, 2, 3, 4, 5].map((i) => Porta.proponiAvviso({
      testo: `avviso numero ${i}`, classe: 'messaggio',
      fonte: `mittente${i}@example.invalid`, modelloProduttore: 'scrittore',
    })));
    assert.deepEqual(esiti.map((e) => e.esito), ['passa', 'passa', 'passa', 'passa', 'passa']);
    const lista = await Mem.listNotifications();
    assert.equal(lista.length, 5, 'cinque proposte, cinque avvisi');
  });

  test('col guardiano che non risponde finiscono tutti in coda, non a schermo', async () => {
    Porta.configure({
      async getSettings() {
        return { models: { [globalThis.SN_CONST.ACTIONS.NOTICE_GUARD]: 'guardia' } };
      },
      modelForAction: (s, a) => s.models[a],
      async runOneShot() { throw new Error('rete giu'); },
    });
    const r = await Porta.proponiAvviso({
      testo: 'tre mail nuove', classe: 'messaggio', fonte: 'posta', modelloProduttore: 'scrittore',
    });
    assert.equal(r.esito, 'attesa');
    assert.equal((await Mem.listNotifications())[0].stato, 'attesa');
  });

  test('se il guardiano girerebbe sul modello che ha scritto il testo, si aspetta', async () => {
    let chiamate = 0;
    Porta.configure({
      async getSettings() {
        return { models: { [globalThis.SN_CONST.ACTIONS.NOTICE_GUARD]: 'scrittore' } };
      },
      modelForAction: (s, a) => s.models[a],
      async runOneShot() { chiamate++; return '{"passa":true}'; },
    });
    const r = await Porta.proponiAvviso({
      testo: 'tre mail nuove', classe: 'messaggio', fonte: 'posta', modelloProduttore: 'scrittore',
    });
    assert.equal(r.esito, 'attesa');
    assert.equal(chiamate, 0, 'non si chiede il parere a chi ha scritto il testo');
  });

  test('i controlli statici fermano senza chiamare nessun modello', async () => {
    let chiamate = 0;
    Porta.configure({
      async getSettings() {
        return { models: { [globalThis.SN_CONST.ACTIONS.NOTICE_GUARD]: 'guardia' } };
      },
      modelForAction: (s, a) => s.models[a],
      async runOneShot() { chiamate++; return '{"passa":true}'; },
    });
    const r = await Porta.proponiAvviso({
      testo: 'Il codice di verifica è 483920.', classe: 'messaggio',
      fonte: 'banca@example.invalid', modelloProduttore: 'scrittore',
    });
    assert.equal(r.esito, 'blocca');
    assert.equal(chiamate, 0);
    // Del testo fermato per un codice non resta un'anteprima: sarebbe una
    // seconda copia del codice.
    const blocchi = await Mem.listBlocchiGuardiano();
    assert.equal(blocchi[0].anteprima, '');
    assert.equal(blocchi[0].regola, 'codice');
  });
});
