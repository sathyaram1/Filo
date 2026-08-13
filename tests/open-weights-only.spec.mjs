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
//      chiama nessun modello;
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

// Chiavi predefinite finte: sono quelle che stanno dietro ai "crediti di Filo".
// Vanno impostate PRIMA che la fixture lanci l'app (le legge da process.env),
// altrimenti la richiesta si fermerebbe su "accedi con un profilo" e il test
// non arriverebbe mai a guardare la catena.
process.env.FILO_DEFAULT_OPENROUTER_KEY = 'k-test-openrouter';
process.env.FILO_DEFAULT_GEMINI_KEY = 'k-test-gemini';

import { test, expect } from './fixtures/electron.mjs';

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

// La dettatura ha bisogno di un modello che ASCOLTI l'audio. Sostituirla con un
// modello a pesi aperti che legge solo testo non è una sostituzione: è una
// funzione che si rompe in mano all'utente con un errore qualunque. Deve invece
// fermarsi nominandosi, come la lettura ad alta voce e l'indicizzazione.
//
// Senza il fix: la catena veniva costruita lo stesso (la sostituzione guardava
// solo i pesi) e la richiesta partiva verso un modello di solo testo.
test('solo modelli a pesi aperti: la dettatura si ferma dicendolo, non con un errore qualunque', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;
    const Storage = globalThis.SN_STORAGE;

    const seen = [];
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      seen.push(attempts.map((a) => a.model));
      const a = attempts[0];
      return { text: 'ciao', model: a.model, provider: a.provider, servedBy: 'DeepInfra', usage: {} };
    };
    const run = async (payload) => {
      const before = seen.length;
      try {
        const r = await globalThis.SN_HANDLE_MESSAGE({
          type: MSG.AI_REQUEST, action: C.ACTIONS.TRANSCRIBE_AUDIO, payload,
        }, {});
        return { ok: true, text: r && r.text, chain: seen[before] || null };
      } catch (e) {
        return { ok: false, message: String(e && e.message), code: e && e.code, chain: seen[before] || null };
      }
    };

    // Configurazione personale controllata dal test: la dettatura sul modello
    // multimodale con cui nasce, e il registry completo (che contiene i
    // sostituti a pesi aperti, tutti di solo testo).
    const config = (openWeightsOnly) => Storage.setSettings({
      useDefaultModels: false,
      openWeightsOnly,
      apiKeys: { openrouter: 'k-test', gemini: 'k-test' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { [C.ACTIONS.TRANSCRIBE_AUDIO]: 'flash, flash-or' },
    });

    const res = {};
    try {
      await config(true);
      res.acceso = await run({ dataUrl: 'data:audio/wav;base64,AAAAAAAA', lang: 'it-IT' });
      await config(false);
      res.spento = await run({ dataUrl: 'data:audio/wav;base64,BBBBBBBB', lang: 'it-IT' });
    } finally {
      globalThis.SN_PROVIDERS.completeWithFallback = orig;
    }
    return res;
  });

  // Acceso: non parte niente, e il messaggio nomina la funzione e il motivo —
  // così l'utente sa che è una scelta sua, non un guasto.
  expect(out.acceso.ok, `catena costruita: ${JSON.stringify(out.acceso.chain)}`).toBe(false);
  expect(out.acceso.chain).toBe(null);
  expect(out.acceso.code).toBe('NO_OPEN_WEIGHTS_MODEL');
  expect(out.acceso.message).toMatch(/dettatura/i);
  expect(out.acceso.message).toMatch(/pesi aperti/i);

  // Spento: la dettatura funziona come prima.
  expect(out.spento.ok, `spento la dettatura deve funzionare: ${out.spento.message}`).toBe(true);
  expect(out.spento.chain).not.toBe(null);
});

// I pulsanti «Prova» delle Opzioni mandano richieste VERE, pagate. Stanno sulla
// stessa pagina dove l'interruttore si accende: se restassero aperti, l'unico
// posto in cui l'utente sceglie "niente modelli proprietari" sarebbe anche
// l'unico da cui ne partono.
//
// Cosa asserisce (successo, non assenza di errore):
//   1. con l'interruttore acceso e i CREDITI DI FILO, provare un modello ammesso
//      funziona e la richiesta porta con sé l'esclusione dei fornitori;
//   2. provare un modello proprietario (Anthropic) o un fornitore diretto
//      (Google) non manda NESSUNA richiesta e dice perché;
//   3. la prova accanto alla chiave OpenRouter parte sull'equivalente a pesi
//      aperti, non sul modello proprietario previsto per le prove;
//   4. la prova della riga di un modello proprietario (config personale) non
//      parte;
//   5. a interruttore spento tutte queste prove ripartono: la differenza la fa
//      l'interruttore.
//
// Senza il fix: 2/3/4 fallirebbero (le richieste partirebbero davvero) e 1
// partirebbe senza esclusione allegata.
test('solo modelli a pesi aperti: nemmeno i pulsanti «Prova» chiamano un escluso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;
    const Storage = globalThis.SN_STORAGE;

    // Ogni chiamata che sarebbe andata in rete finisce qui e non parte.
    const calls = [];
    const orig = globalThis.SN_PROVIDERS.streamComplete;
    globalThis.SN_PROVIDERS.streamComplete = async ({ provider, model, providerRouting, onDelta }) => {
      calls.push({
        provider, model, ignore: (providerRouting && providerRouting.ignore) || [],
      });
      if (onDelta) onDelta('1, 2, 3');
      return { text: '1, 2, 3', servedBy: 'DeepInfra', usage: { completionTokens: 5 } };
    };

    const prova = async (msg) => {
      const before = calls.length;
      const r = await globalThis.SN_HANDLE_MESSAGE(msg, {});
      return { ok: !!(r && r.ok), error: r && r.error, chiamata: calls[before] || null };
    };

    const res = {};
    try {
      // ── Crediti di Filo (registry predefinito), interruttore ACCESO.
      await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: true });

      // La lista dei modelli predefiniti è quella VERA (costanti + config
      // condivisa dell'owner, che cambia nel tempo): le righe da provare si
      // scelgono da lì invece di scriverne i nomi qui, così il test verifica la
      // regola e non una fotografia della configurazione di oggi.
      const pubblici = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.DEFAULT_MODELS_PUBLIC }, {});
      const registry = (pubblici && pubblici.modelRegistry) || {};
      const nick = { aperto: '', escluso: '' };
      for (const [n, entry] of Object.entries(registry)) {
        if (C.isOpenWeightsEntry(entry)) { if (!nick.aperto) nick.aperto = n; }
        else if (!nick.escluso) nick.escluso = n;
      }
      res.nick = nick;

      // 1. Riga di un modello a pesi aperti: la prova funziona davvero.
      res.ammesso = await prova({ type: MSG.TEST_DEFAULT_MODEL, nickname: nick.aperto });
      // 2. Riga di un modello che l'interruttore esclude (modello proprietario,
      //    oppure servito dall'API del produttore).
      res.escluso = await prova({ type: MSG.TEST_DEFAULT_MODEL, nickname: nick.escluso });
      // 3. Prova accanto alla chiave OpenRouter (nessun modello indicato).
      res.chiaveOr = await prova({ type: MSG.TEST_PROVIDER, provider: 'openrouter', apiKey: 'k-test' });
      // …e accanto alla chiave Google.
      res.chiaveGemini = await prova({ type: MSG.TEST_PROVIDER, provider: 'gemini', apiKey: 'k-test' });
      // 4. Riga del registry con un modello proprietario scritto a mano.
      res.rigaProprietaria = await prova({
        type: MSG.TEST_PROVIDER, provider: 'openrouter', apiKey: 'k-test',
        model: 'anthropic/claude-3.7-sonnet',
      });

      // ── 5. Stessa pagina, interruttore SPENTO.
      await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: false });
      res.spentoEscluso = await prova({ type: MSG.TEST_DEFAULT_MODEL, nickname: nick.escluso });
      res.spentoRiga = await prova({
        type: MSG.TEST_PROVIDER, provider: 'openrouter', apiKey: 'k-test',
        model: 'anthropic/claude-3.7-sonnet',
      });
      res.spentoGemini = await prova({ type: MSG.TEST_PROVIDER, provider: 'gemini', apiKey: 'k-test' });
    } finally {
      globalThis.SN_PROVIDERS.streamComplete = orig;
    }
    res.totaleChiamate = calls.map((c) => `${c.provider}::${c.model}`);
    return res;
  });

  const proprietari = /gemini|claude|gpt-|grok/i;

  // 1. La prova di un modello ammesso RIESCE, e non passa da un escluso.
  expect(out.ammesso.ok, `la prova di un modello a pesi aperti deve funzionare: ${out.ammesso.error}`).toBe(true);
  expect(out.ammesso.chiamata).not.toBe(null);
  expect(out.ammesso.chiamata.provider).toBe('openrouter');
  expect(out.ammesso.chiamata.model).not.toMatch(proprietari);
  expect(out.ammesso.chiamata.ignore.map((s) => s.toLowerCase())).toContain('anthropic');
  expect(out.ammesso.chiamata.ignore.map((s) => s.toLowerCase())).toContain('google');

  // 2. Le prove verso un escluso non partono affatto.
  for (const caso of ['anthropic', 'tts', 'embed', 'chiaveGemini', 'rigaProprietaria']) {
    expect(out[caso].chiamata, `«${caso}»: non deve partire nessuna richiesta`).toBe(null);
    expect(out[caso].ok).toBe(false);
    expect(out[caso].error).toMatch(/pesi aperti/i);
  }

  // 3. La prova della chiave OpenRouter parte, ma sull'equivalente aperto.
  expect(out.chiaveOr.ok, `la prova della chiave deve funzionare: ${out.chiaveOr.error}`).toBe(true);
  expect(out.chiaveOr.chiamata.model).not.toMatch(proprietari);
  expect(out.chiaveOr.chiamata.ignore.map((s) => s.toLowerCase())).toContain('anthropic');

  // 5. Spento, le stesse prove ripartono: la differenza la fa l'interruttore.
  expect(out.spentoAnthropic.chiamata).not.toBe(null);
  expect(out.spentoAnthropic.chiamata.model).toMatch(/claude/i);
  // La prova della chiave Google non è più fermata dall'interruttore (quello che
  // resta è la configurazione del modello di prova, che l'interruttore non
  // riguarda).
  expect(String(out.spentoGemini.error || '')).not.toMatch(/pesi aperti/i);

  // Controprova d'insieme: con l'interruttore acceso nessun modello proprietario
  // è mai finito in una chiamata.
  const acceso = out.totaleChiamate.slice(0, out.totaleChiamate.length - 2);
  for (const c of acceso) expect(c).not.toMatch(proprietari);
});
