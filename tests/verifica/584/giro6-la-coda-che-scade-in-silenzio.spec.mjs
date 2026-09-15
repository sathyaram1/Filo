// #584, sesto giro — cosa succede ai percorsi finché la strada nuova non è
// aperta.
//
// Da questo lavoro il percorso non parte più dal computer di chi naviga: lo
// spedisce il server, attraverso una funzione che — lo dichiara il lavoro
// stesso — ancora non esiste. Quindi ogni invio fallisce, il percorso resta in
// coda e si riprova. Dopo un mese la coda lo butta.
//
// Quel «lo butta» non diceva niente a nessuno: né all'utente, che non ha dove
// guardarlo, né ai log. Se la funzione del server non arriva, la raccolta si
// ferma e non se ne accorge nessuno. CORRETTO nello stesso giro: la scadenza
// adesso lo scrive, e dice quanti percorsi ha buttato.

import { test, expect } from '../../fixtures/electron.mjs';

const UN_MESE = 30 * 24 * 60 * 60 * 1000;

test('un percorso che non riesce mai a partire sparisce dopo un mese, e la scadenza lo dice', async ({ app }) => {
  const esito = await app.evaluate(async ({ app: _a }, { UN_MESE }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);

    // La strada nuova non c'è: ogni invio fallisce, come oggi in produzione.
    const submitVero = P.submit;
    let tentativi = 0;
    P.submit = async () => { tentativi += 1; throw new Error('pathSubmit 404'); };

    // Ogni parola detta nei log, di qualunque livello.
    const detto = [];
    const veri = { warn: console.warn, info: console.info, error: console.error, log: console.log };
    for (const k of Object.keys(veri)) console[k] = (...a) => { detto.push(a.join(' ')); veri[k](...a); };

    await C.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/account/ordini',
        rawSteps: [{ selector: '[aria-label="Ordini"]', action: 'click' }],
        rawUserMessages: ['dove sono i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'trovare gli ordini passati' }
        : { text: '{"ok": true}' }),
    });
    const accodati = C._peek().length;

    // Un giro subito dopo che sarebbe maturo: fallisce e il percorso resta.
    const ora = Date.now();
    await C.flush({ now: ora + 25 * 60 * 60 * 1000 });
    const dopoUnGiorno = C._peek().length;
    const dettoAlPrimoGiro = detto.slice();

    // Un mese e un minuto dopo: la coda lo butta.
    detto.length = 0;
    await C.flush({ now: ora + UN_MESE + 60000 });
    const dopoUnMese = C._peek().length;
    const dettoAllaScadenza = detto.slice();

    for (const k of Object.keys(veri)) console[k] = veri[k];
    P.submit = submitVero;
    C._reset();
    return { accodati, dopoUnGiorno, dopoUnMese, tentativi, dettoAlPrimoGiro, dettoAllaScadenza };
  }, { UN_MESE });

  expect(esito.accodati).toBe(1);
  // Un invio fallito non perde il percorso: si riprova. Questo va bene.
  expect(esito.tentativi).toBeGreaterThan(0);
  expect(esito.dopoUnGiorno).toBe(1);
  expect(esito.dettoAlPrimoGiro.join(' ')).toContain('invio fallito');

  // La scadenza lo butta, e lo dice: senza quella riga la raccolta si fermerebbe
  // senza un segno, ed è esattamente lo stato in cui si trova oggi.
  expect(esito.dopoUnMese).toBe(0);
  expect(esito.dettoAllaScadenza.join(' ')).toMatch(/scadut/i);
  expect(esito.dettoAllaScadenza.join(' ')).toContain('1');
});

test('RILIEVO (decisione dell’owner): finché aspetta non c’è modo di ritirarlo, benché sia ancora qui', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    await C.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/account/ordini',
        rawSteps: [{ selector: '[aria-label="Ordini"]', action: 'click' }],
        rawUserMessages: ['dove sono i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'trovare gli ordini passati' }
        : { text: '{"ok": true}' }),
    });
    const voce = C._peek()[0];
    const api = Object.keys(globalThis.SN_PATHS_COLLECTOR)
      .filter((k) => !k.startsWith('_'));
    C._reset();
    return { attesa: voce.nonPrimaDi - voce.accodatoIl, api };
  });

  // Il percorso resta sul computer di chi l'ha fatto per ore: mezz'ora nel
  // caso più corto, fino a un giorno.
  expect(esito.attesa).toBeGreaterThan(29 * 60 * 1000);

  // In tutto quel tempo è ancora suo, e non c'è niente per ritirarlo: né una
  // funzione pubblica del modulo, né un messaggio, né una pagina. Le uniche
  // strade sono quelle riservate ai test (`_reset`, `_peek`). `raccoglibile`,
  // arrivata col settimo giro, risponde solo a «da qui partirebbe qualcosa?»:
  // non tocca la coda e non ritira niente.
  expect(esito.api.sort()).toEqual(['collectAndSave', 'flush', 'inCoda', 'init', 'raccoglibile']);
});
