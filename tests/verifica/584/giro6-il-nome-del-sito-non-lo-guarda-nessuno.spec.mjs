// #584, sesto giro — il nome del sito.
//
// Quello che un percorso pubblica è quattro cose: il NOME DEL SITO, la pagina
// di partenza, i nomi degli elementi toccati e la frase dell'intento. Il lavoro
// aveva messo le ultime tre in fila davanti a due difese, la cancellazione per
// forme (email, IBAN, codici, numeri) e il modello che giudica, al quale i giri
// passati hanno fatto arrivare «quello che verrebbe pubblicato».
//
// La prima non passava da nessuna delle due. Il nome del sito non si può
// ripulire, perché è anche l'indirizzo Firestore del documento: cambiarlo
// vorrebbe dire scriverlo dove nessuno lo cercherà. E al giudice non arrivava:
// la sua domanda enumerava TRE parti pubblicate, e quella non c'era.
//
// Su un sito comune non dice niente di nessuno. Su un host personale o privato,
// il proprio sito, il proprio pannello, il disco di rete di casa, l'intranet
// dell'ufficio, è un nome e cognome oppure il nome del datore di lavoro.
//
// CORRETTO nello stesso giro, in due mosse. I siti che non sono di nessuno non
// si raccolgono più: indirizzi numerici, nomi di una parola sola, suffissi di
// rete locale, le pagine interne di Filo. Lì un percorso condiviso non serve a
// nessun altro, quindi rifiutarlo non toglie niente a nessuno. Per tutti gli
// altri il nome del sito arriva al giudice insieme alle altre tre parti, e la
// sua regola dice quando è un motivo per rifiutare.
//
// Queste prove guardano la difesa. Senza la correzione sono rosse.

import { test, expect } from '../../fixtures/electron.mjs';

// Host pubblici il cui nome dice di chi sono: escono interi, e a deciderli è il
// giudice, perché fra questi e un sito qualunque non c'è una forma che li
// distingua.
const SITI_CHE_NOMINANO = [
  'mariorossi.github.io',
  'mario-rossi.myshopify.com',
  'u8172635.hosting.example.com',
];

// Indirizzi che non portano da nessuna parte fuori da casa di chi naviga: qui
// non si chiede niente a nessun modello, non si raccoglie e basta.
const NON_SONO_SITI = [
  'http://localhost:3000/admin/utenti',
  'http://192.168.1.1/setup/wan',
  'https://nas-rossi.local/files/foto',
  'https://portale.intranet/hr/ferie',
  'filo://options/options.html',
];

async function raccogli(app, rawUrl) {
  return app.evaluate(async ({ app: _a }, { rawUrl }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    const submitVero = P.submit;
    let spedizioni = 0;
    P.submit = async () => { spedizioni += 1; return { id: 'mai' }; };
    const visti = [];
    const r = await C.collectAndSave({
      session: {
        rawUrl,
        rawSteps: [{ selector: '[aria-label="Impostazioni"]', action: 'click' }],
        rawUserMessages: ['come cambio le impostazioni?'],
        success: true,
      },
      invokeAI: async ({ action, payload }) => {
        visti.push({ action, payload });
        return action === 'help_intent_guess'
          ? { text: 'cambiare le impostazioni' }
          : { text: '{"ok": true}' };
      },
    });
    const coda = C._peek();
    P.submit = submitVero;
    C._reset();
    return { r, coda, visti, spedizioni };
  }, { rawUrl });
}

test('il nome del sito esce intero: non si può ripulire, quindi lo deve guardare qualcuno', async ({ app }) => {
  for (const host of SITI_CHE_NOMINANO) {
    const { r, coda } = await raccogli(app, `https://${host}/pannello/impostazioni`);
    expect(r.saved, `${host}: il percorso viene accettato`).toBe(true);
    expect(coda.length).toBeGreaterThan(0);
    // Quello che aspetta di partire porta il nome dell'host, tale e quale: è
    // anche l'indirizzo Firestore sotto cui il documento va a finire.
    // (La coda vive sul disco del profilo di prova e si porta dietro i giri
    // precedenti di questo stesso test: guarda l'ultima voce.)
    expect(coda[coda.length - 1].domain, `${host}: esce intero`).toBe(host);
  }
});

test('al giudice, l’unica difesa che legge le parole, il nome del sito adesso arriva', async ({ app }) => {
  const host = 'mariorossi.github.io';
  const { visti } = await raccogli(app, `https://${host}/blog/post`);
  const giudice = visti.find((v) => v.action === 'help_intent_judge');
  const proponente = visti.find((v) => v.action === 'help_intent_guess');
  expect(giudice, 'il giudice viene interpellato').toBeTruthy();

  // Ce l'hanno tutti e due: chi propone la frase, per capire di che sito si
  // tratta, e chi decide se pubblicare, perché quel nome esce così com'è.
  expect(proponente.payload.domain).toBe(host);
  expect(giudice.payload.domain).toBe(host);
});

test('e la domanda vera che arriva al modello lo nomina, e dice quando rifiutarlo', async ({ app }) => {
  const host = 'mariorossi.github.io';
  const testo = await app.evaluate(async ({ app: _a }, { host }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP_INTENT_JUDGE]: 'deepseek-flash',
        [C.ACTIONS.HELP_INTENT_GUESS]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const H = globalThis.__filoHandlers;
    const P = globalThis.SN_PROVIDERS;
    const veroC = P.completeWithFallback;
    const veroS = P.streamCompleteWithFallback;
    const visti = [];
    const finto = async ({ messages }) => {
      visti.push(messages);
      return { text: '{"ok":true}', model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    try {
      await H.handleAIRequest({
        action: C.ACTIONS.HELP_INTENT_JUDGE,
        payload: {
          proposedIntent: 'vedere i post',
          userMessages: ['come vedo i post'],
          initialUrl: '/blog/post',
          steps: [{ selector: '#a', action: 'click' }],
          domain: host,
        },
        origin: 'test',
        noCache: true,
      });
    } finally {
      P.completeWithFallback = veroC;
      P.streamCompleteWithFallback = veroS;
    }
    return JSON.stringify(visti);
  }, { host });

  // Il giudice si trova davanti la pagina di partenza (la correzione del terzo
  // giro tiene) e adesso anche il nome del sito.
  expect(testo).toContain('/blog/post');
  expect(testo).toContain(host);
  // E il conto delle parti pubblicate segue quello che gli si mostra davvero:
  // finché diceva «tre», il sito non era nemmeno nell'elenco delle cose da
  // guardare.
  expect(testo).toContain('delle quattro parti che verrebbero pubblicate');
  expect(testo).not.toContain('delle tre parti che verrebbero pubblicate');
  // Vederlo non basta: gli si dice quando è un motivo per rifiutare.
  expect(testo).toContain('NOME DEL SITO dice di chi è invece che cosa è');
});

test('la cancellazione per forme il nome del sito non lo tocca, e non potrebbe', async ({ app }) => {
  const forme = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const prova = (host) => {
      const r = S.sanitizeSubmission({
        domain: host,
        initialUrl: `https://${host}/x`,
        intent: 'fare una cosa',
        steps: [{ selector: '#a', action: 'click' }],
      });
      return r.ok ? r.doc.domain : `KO:${r.reason}`;
    };
    return {
      numeroLungo: prova('u8172635.hosting.example.com'),
      nome: prova('mario-rossi.myshopify.com'),
      // La stessa cifra dentro un'etichetta, invece, viene sostituita.
      dentroUnElemento: S._internal.redactSelector('[aria-label="cliente 8172635"]'),
    };
  });
  // Esce intero, ed è voluto: un nome di sito riscritto è un documento che
  // nessuno andrà a leggere. Per questo il bivio lo decide il giudice.
  expect(forme.numeroLungo).toBe('u8172635.hosting.example.com');
  expect(forme.nome).toBe('mario-rossi.myshopify.com');
  expect(forme.dentroUnElemento).toContain('[NUMERO]');
});

test('e quello che non è un sito non diventa più una cartella pubblica', async ({ app }) => {
  for (const rawUrl of NON_SONO_SITI) {
    const { r, coda, visti, spedizioni } = await raccogli(app, rawUrl);
    expect(r.saved, `${rawUrl}: non si raccoglie`).toBe(false);
    expect(r.reason).toMatch(/privato o locale/);
    expect(coda.length).toBe(0);
    expect(spedizioni).toBe(0);
    // e ci si ferma prima dei due modelli, che si pagano a ogni chiamata
    expect(visti, `${rawUrl}: nessuna chiamata sprecata`).toEqual([]);
  }
});
