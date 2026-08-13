// #461 — l'interruttore "solo modelli a pesi aperti" nel processo reale dell'app.
//
// La promessa della politica sui modelli è verificabile solo guardando cosa
// parte davvero: il test intercetta la catena di tentativi COSTRUITA dall'app
// (non una funzione pura) in tutt'e due i modi in cui Filo lavora — con i
// CREDITI DI FILO (modelli e chiavi predefiniti, il caso in cui prima l'utente
// non aveva voce in capitolo) e con una configurazione personale.
//
// Cosa asserisce (successo, non assenza di errore):
//   1. a interruttore acceso una funzione che nasce su un modello proprietario
//      RISPONDE lo stesso, servita dal suo equivalente a pesi aperti;
//   2. nessun tentativo passa dall'API diretta del produttore né cita un modello
//      proprietario, e la richiesta porta con sé l'esclusione di Anthropic;
//   3. se il sostituto non risponde, la catena NON ripiega su un modello
//      proprietario: la richiesta fallisce e basta;
//   4. la funzione senza equivalente aperto si ferma dicendo perché, e non
//      chiama nessun modello — vale anche quando l'equivalente esiste ma non sa
//      fare quel mestiere (la dettatura deve ASCOLTARE: un sostituto che legge
//      solo testo la romperebbe con un errore qualunque);
//   5. chi ha SERVITO davvero la risposta viene controllato: se risulta escluso,
//      la voce di cronologia resta marchiata invece di passare inosservata;
//   6. a interruttore spento il modello proprietario torna, cioè la differenza
//      la fa l'interruttore e non altro.
//
// Senza il fix: il punto 1 arriverebbe da un modello proprietario, i punti 2/3/4
// fallirebbero (la catena proprietaria resta intatta) e il 5 non esisterebbe.
//
// NB: con i crediti di Filo la configurazione vera arriva dalla rete e cambia
// nel tempo — lì il test asserisce le PROPRIETÀ della catena (pesi aperti,
// nessun produttore diretto), non nomi di modelli che l'owner può cambiare
// domani. I nomi esatti si asseriscono sulla configurazione personale, che il
// test controlla per intero.

import { test, expect } from './fixtures/electron.mjs';

// Chiavi predefinite finte: sono quelle che stanno dietro ai "crediti di Filo".
// Vanno impostate PRIMA che la fixture lanci l'app (le legge da process.env),
// altrimenti la richiesta si fermerebbe su "accedi con un profilo" e il test non
// arriverebbe mai a guardare la catena.
// SOLO per questo file: il worker di Playwright è un processo solo per decine di
// spec, quindi scriverle a livello di modulo le lasciava accese anche dopo — e
// gli spec che verificano il comportamento SENZA chiavi (la home che invita a
// registrarsi) fallivano a seconda dell'ordine.
const CHIAVI = { FILO_DEFAULT_OPENROUTER_KEY: 'k-test-openrouter', FILO_DEFAULT_GEMINI_KEY: 'k-test-gemini' };
const primaDi = {};
test.beforeAll(() => {
  for (const [k, v] of Object.entries(CHIAVI)) { primaDi[k] = process.env[k]; process.env[k] = v; }
});
test.afterAll(() => {
  for (const k of Object.keys(CHIAVI)) {
    if (primaDi[k] === undefined) delete process.env[k];
    else process.env[k] = primaDi[k];
  }
});

async function waitForBoot(app) {
  const deadline = Date.now() + 10_000;
  let tab = null;
  while (Date.now() < deadline) {
    tab = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (tab) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
}

test('solo modelli a pesi aperti: sostituisce, non ripiega, e lo dimostra', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;
    const Storage = globalThis.SN_STORAGE;
    const History = globalThis.SN_HISTORY;

    // Registra ogni tentativo costruito dall'app e risponde col primo, così si
    // vede ESATTAMENTE cosa sarebbe partito verso la rete.
    const seen = [];
    let servedByNext = 'DeepInfra';
    let failAll = false;
    const origComplete = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      seen.push(attempts.map((a) => ({
        provider: a.provider,
        model: a.model,
        ignore: (a.providerRouting && a.providerRouting.ignore) || [],
      })));
      if (failAll) throw new Error('nessun fornitore disponibile');
      const a = attempts[0];
      return {
        text: 'risposta', model: a.model, provider: a.provider,
        servedBy: servedByNext, usage: {},
      };
    };

    const run = async (action, payload) => {
      const before = seen.length;
      try {
        const r = await globalThis.SN_HANDLE_MESSAGE(
          { type: MSG.AI_REQUEST, action, payload: payload || {} }, {},
        );
        return { ok: true, text: r && r.text, model: r && r.model, chain: seen[before] || [] };
      } catch (e) {
        return { ok: false, message: String(e && e.message), code: e && e.code, chain: seen[before] || null };
      }
    };

    // Configurazione personale controllata dal test: registry integrale (contiene
    // sia i modelli proprietari sia i sostituti a pesi aperti) e tre funzioni
    // messe apposta su tre casi diversi.
    const usaConfigPersonale = (openWeightsOnly) => Storage.setSettings({
      useDefaultModels: false,
      openWeightsOnly,
      apiKeys: { openrouter: 'k-test', gemini: 'k-test' },
      modelRegistry: {
        ...C.DEFAULT_MODEL_REGISTRY,
        // Modello proprietario scelto a mano: nessun sostituto previsto per lui.
        'mio-claude': { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' },
      },
      models: {
        [C.ACTIONS.EXPLAIN]: 'flash, flash-or',          // proprietario con equivalente
        [C.ACTIONS.EXPLAIN_DEEP]: 'claude-haiku',        // Anthropic, con equivalente
        [C.ACTIONS.EXPLAIN_LINK]: 'mio-claude',          // proprietario SENZA equivalente
        // Proprietari con un equivalente aperto, ma che chiedono al modello due
        // mestieri diversi: ascoltare un audio (nessun sostituto lo fa) e
        // guardare un'immagine (i sostituti sì).
        [C.ACTIONS.TRANSCRIBE_AUDIO]: 'flash, flash-or',
        [C.ACTIONS.DESCRIBE_IMAGE]: 'flash-lite-3, flash-lite-3-or',
      },
    });

    const res = {};
    try {
      // ── A) Crediti di Filo: modelli e chiavi PREDEFINITI, interruttore acceso.
      await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: true });
      try { await History.clear(); } catch (_) {}
      res.crediti = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });

      // Controprova sul SERVITO: se chi ha servito è escluso, la voce di
      // cronologia lo dice invece di far passare la cosa in silenzio.
      servedByNext = 'Google AI Studio';
      await run(C.ACTIONS.EXPLAIN, { selection: 'x', sentence: 'y' });
      const items = await History.list();
      res.ultimaVoce = items && items[0]
        ? { servedBy: items[0].servedBy, policyViolation: items[0].policyViolation }
        : null;
      servedByNext = 'DeepInfra';

      // ── B) Configurazione personale, interruttore ACCESO.
      await usaConfigPersonale(true);
      res.acceso = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });
      res.anthropic = await run(C.ACTIONS.EXPLAIN_DEEP, { selection: 'ciao', sentence: 'ciao mondo' });
      res.senzaEquivalente = await run(C.ACTIONS.EXPLAIN_LINK, { url: 'https://example.com', text: 'x' });

      // La dettatura ha bisogno di ASCOLTARE un audio: i sostituti a pesi aperti
      // leggono testo (e immagini). Deve fermarsi dicendolo, non finire su un
      // modello sordo che poi fallirebbe con un errore qualunque.
      res.dettatura = await run(C.ACTIONS.TRANSCRIBE_AUDIO, {
        dataUrl: 'data:audio/webm;base64,AAAA', lang: 'it',
      });
      // La descrizione di un'immagine invece un equivalente ce l'ha: non deve
      // essere spenta per compagnia.
      res.immagine = await run(C.ACTIONS.DESCRIBE_IMAGE, {
        dataUrl: 'data:image/png;base64,AAAA',
      });

      // Il sostituto non risponde: non deve esistere un tentativo proprietario dopo.
      // Testo diverso da quello di prima: una richiesta identica verrebbe
      // servita dalla cache e non proverebbe nessun modello.
      failAll = true;
      res.tuttoGiu = await run(C.ACTIONS.EXPLAIN, { selection: 'altro', sentence: 'un altro testo' });
      failAll = false;

      // ── C) Stessa configurazione, interruttore SPENTO: il proprietario torna.
      await usaConfigPersonale(false);
      res.spento = await run(C.ACTIONS.EXPLAIN_DEEP, { selection: 'terzo', sentence: 'un terzo testo' });
    } finally {
      globalThis.SN_PROVIDERS.completeWithFallback = origComplete;
    }
    return res;
  });

  const proprietari = /gemini|claude|gpt-|grok/i;

  // ── A) Crediti di Filo ─────────────────────────────────────────────────────
  // 1+2. La richiesta parte e riesce, e tutto ciò che sarebbe andato in rete è
  //      ammesso dalla politica (pesi aperti, mai l'API diretta del produttore).
  expect(out.crediti.ok, `coi crediti di Filo la funzione deve funzionare: ${out.crediti.message}`).toBe(true);
  expect(out.crediti.text).toBe('risposta');
  expect(out.crediti.chain.length).toBeGreaterThan(0);
  for (const a of out.crediti.chain) {
    expect(a.provider, 'l\'API diretta del produttore non deve comparire').toBe('openrouter');
    expect(a.model, `modello proprietario nella catena: ${a.model}`).not.toMatch(proprietari);
    expect(a.ignore.map((s) => s.toLowerCase())).toContain('anthropic');
    expect(a.ignore.map((s) => s.toLowerCase())).toContain('google');
  }

  // 5. Controprova su chi ha servito: marchiata, non silenziosa.
  expect(out.ultimaVoce).not.toBe(null);
  expect(out.ultimaVoce.servedBy).toBe('Google AI Studio');
  expect(out.ultimaVoce.policyViolation).toBe(true);

  // ── B) Configurazione personale, interruttore acceso ───────────────────────
  // 1. Sostituzione col modello a pesi aperti previsto, e la funzione risponde.
  expect(out.acceso.ok, `la funzione deve continuare a funzionare: ${out.acceso.message}`).toBe(true);
  expect(out.acceso.model).toBe('google/gemma-4-31b-it');
  expect(out.anthropic.ok).toBe(true);
  expect(out.anthropic.model).toBe('deepseek/deepseek-v4-pro');
  for (const a of out.acceso.chain.concat(out.anthropic.chain)) {
    expect(a.provider).toBe('openrouter');
    expect(a.model).not.toMatch(proprietari);
    expect(a.ignore.map((s) => s.toLowerCase())).toContain('anthropic');
  }

  // 4. Funzione senza equivalente: si ferma, non chiama niente, e lo dice.
  expect(out.senzaEquivalente.ok).toBe(false);
  expect(out.senzaEquivalente.code).toBe('NO_OPEN_WEIGHTS_MODEL');
  expect(out.senzaEquivalente.chain).toBe(null);
  expect(out.senzaEquivalente.message).toMatch(/pesi aperti/i);

  // 4-bis. Il sostituto deve saper fare il mestiere: la dettatura ha bisogno di
  //        ascoltare, e nessun modello a pesi aperti raggiungibile lo fa → si
  //        ferma dicendolo, senza chiamare niente. Chi invece un equivalente
  //        capace ce l'ha (le immagini) non viene spento per compagnia.
  expect(out.dettatura.ok, `la dettatura è finita su ${out.dettatura.model}`).toBe(false);
  expect(out.dettatura.code).toBe('NO_OPEN_WEIGHTS_MODEL');
  expect(out.dettatura.chain).toBe(null);
  expect(out.immagine.ok, `la descrizione immagini deve continuare: ${out.immagine.message}`).toBe(true);
  expect(out.immagine.model).toBe('google/gemma-4-26b-a4b-it');

  // 3. Sostituto giù → nessun ripiego proprietario: la richiesta fallisce e la
  //    catena tentata resta di soli modelli ammessi.
  expect(out.tuttoGiu.ok).toBe(false);
  for (const a of out.tuttoGiu.chain) {
    expect(a.model).not.toMatch(proprietari);
  }

  // ── C) Interruttore spento: la differenza la fa lui ────────────────────────
  expect(out.spento.ok).toBe(true);
  expect(out.spento.model).toBe('anthropic/claude-3.5-haiku');
});
