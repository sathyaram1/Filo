// #584, dodicesimo giro — RILIEVO: i percorsi condivisi di un sito non
// cambiano durante una sessione di Aiuto, e Filo se li riprende a ogni passo.
//
// Queste prove FISSANO IL COMPORTAMENTO DI OGGI: diventeranno rosse quando la
// lettura verra' tenuta da parte per la durata della sessione e il blocco dei
// percorsi verra' spostato prima dell'outline, ed e' giusto che sia chi
// corregge ad aggiornare l'attesa.
//
// Perche' conta: l'Aiuto e' fatto di passi, e a ogni passo il modello aspetta
// che Firestore risponda prima di poter parlare. Il fratello che gli sta
// accanto nella stessa Promise.all — l'llms.txt del sito — la stessa risposta
// se la tiene per ventiquattr'ore.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'negoziofelice.it';

function docFinto(i) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/paths/${SITO}/entries/d${i}`,
      createTime: '2026-09-15T06:00:00.000000Z',
      fields: {
        domain: { stringValue: SITO },
        initialUrl: { stringValue: '/account/ordini' },
        intent: { stringValue: `fare la cosa numero ${i}` },
        success: { booleanValue: true },
        createdAt: { timestampValue: '2026-09-15T00:00:00Z' },
        steps: { arrayValue: { values: [{ mapValue: { fields: {
          selector: { stringValue: `[aria-label="Pulsante numero ${i} con un'etichetta lunga come quelle vere"]` },
          action: { stringValue: 'click' },
          retracted: { booleanValue: false },
        } } }] } },
      },
    },
  };
}

async function sessione(app, turni) {
  return app.evaluate(async ({ app: _a }, turni) => {
    const C = globalThis.SN_CONST;
    const H = globalThis.__filoHandlers;
    const P = globalThis.SN_PROVIDERS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const righe = globalThis.__righeFinte;
    const corpo = JSON.stringify(righe);
    const fetchVero = globalThis.fetch;
    let richieste = 0;
    let byte = 0;
    globalThis.fetch = async (u) => {
      if (String(u).includes('/documents/paths')) {
        richieste += 1;
        byte += corpo.length;
        return new Response(corpo, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    };
    const veroC = P.completeWithFallback;
    const veroS = P.streamCompleteWithFallback;
    const sistemi = [];
    const finto = async ({ messages }) => {
      const s = (messages || []).find((m) => m.role === 'system');
      sistemi.push((s && s.content) || '');
      return { text: '{"status":"continue"}', model: 'f', provider: 'f', costEur: 0, usage: {} };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    try {
      for (let i = 0; i < turni; i += 1) {
        await H.handleAIRequest({
          action: C.ACTIONS.HELP,
          payload: {
            url: `https://negoziofelice.it/account/ordini`,
            title: 'I miei ordini',
            outline: `passo ${i}: l'outline cambia a ogni passo`,
            viewport: { w: 1200, h: 800 },
            userMessage: `passo ${i}`,
          },
          origin: 'test',
          noCache: true,
        });
      }
    } finally {
      P.completeWithFallback = veroC;
      P.streamCompleteWithFallback = veroS;
      globalThis.fetch = fetchVero;
    }
    return { richieste, byte, sistemi };
  }, turni);
}

test.beforeEach(async ({ app }) => {
  const righe = Array.from({ length: 50 }, (_, i) => docFinto(i));
  await app.evaluate(async ({ app: _a }, righe) => { globalThis.__righeFinte = righe; }, righe);
});

test('RILIEVO: una sessione di Aiuto di otto passi scarica otto volte gli stessi percorsi', async ({ app }) => {
  const r = await sessione(app, 8);
  // Oggi: una richiesta per passo. Con una copia tenuta da parte per la
  // sessione sarebbe una sola, come fa gia' l'llms.txt.
  expect(r.richieste).toBe(8);
  // E il blocco dei percorsi e' identico a ogni passo: non c'e' niente da
  // rileggere.
  const blocchi = r.sistemi.map((s) => {
    const a = s.indexOf('<<<PERCORSI_CONDIVISI>>>');
    const b = s.indexOf('<<<FINE_PERCORSI_CONDIVISI>>>');
    return a >= 0 && b > a ? s.slice(a, b) : '';
  });
  expect(blocchi[0].length).toBeGreaterThan(0);
  for (const b of blocchi) expect(b).toBe(blocchi[0]);
  // eslint-disable-next-line no-console
  console.log(`[giro12] otto passi: ${r.richieste} richieste, ${r.byte} byte scaricati`);
});

test('RILIEVO: nel prompt i percorsi stanno DOPO l’outline, che cambia a ogni passo', async ({ app }) => {
  const r = await sessione(app, 1);
  const s = r.sistemi[0];
  const outline = s.indexOf("Outline interattivo");
  const percorsi = s.indexOf('# Percorsi condivisi su questo dominio');
  expect(outline).toBeGreaterThan(-1);
  expect(percorsi).toBeGreaterThan(-1);
  // Oggi la parte che NON cambia in una sessione sta dopo quella che cambia a
  // ogni passo, quindi non puo' viaggiare nel prefisso in cache: la regola del
  // repo (#422) e' che l'immutabile venga prima.
  expect(percorsi).toBeGreaterThan(outline);
  // eslint-disable-next-line no-console
  console.log(`[giro12] blocco percorsi lungo ${s.length - percorsi} caratteri, dopo l'outline`);
});
