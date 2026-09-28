// Nell'app vera i chiamanti di servizio passano dal cancello dei modelli (#591): oltre il limite di spesa del mese il
// riconoscimento del blocco geografico, il giudice anti-phishing e la lettura ad alta voce non chiamano nessun fornitore;
// sotto il limite chiamano, e il costo entra nel conteggio del mese. Senza il cancello queste chiamate partivano comunque.

import { test, expect } from './fixtures/electron.mjs';

// Configurazione di prova, fornitore finto che conta le chiamate, spesa del mese spinta oltre il limite.
async function prepara(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...T.models },
      modelRegistry: T.registry,
      monthlyLimitEur: 5,
    });
    const P = globalThis.SN_PROVIDERS;
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__cancello = {
      vero: { c: P.completeWithFallback, s: P.streamCompleteWithFallback, voce: OR.synthesizeSpeech },
      chiamate: [],
    };
    const finto = async ({ attempts, messages }) => {
      const testo = JSON.stringify(messages || []);
      globalThis.__cancello.chiamate.push(testo.includes('METADATI') ? 'giudice' : 'testo');
      const text = testo.includes('METADATI') ? '{"suspicious":false,"reason":null,"confidence":"low"}' : 'geo_block';
      return { text, provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 200, completionTokens: 5, costUsd: 0.0005 } };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    OR.synthesizeSpeech = async () => {
      globalThis.__cancello.chiamate.push('voce');
      return { audioBase64: 'AAAA', mimeType: 'audio/pcm;rate=24000', generationId: null };
    };
    await globalThis.SN_COSTS.record({ action: 'filo_chat', provider: 'openrouter', model: 'x', usage: { costUsd: 50 }, usdToEur: 1 });
  });
}

async function ripristina(app) {
  await app.evaluate(() => {
    const c = globalThis.__cancello;
    if (!c) return;
    globalThis.SN_PROVIDERS.completeWithFallback = c.vero.c;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = c.vero.s;
    globalThis.SN_PROVIDER_OPENROUTER.synthesizeSpeech = c.vero.voce;
  });
}

const spesaPer = (app, azione) => app.evaluate(async (_e, a) => (await globalThis.SN_COSTS.getMonthly()).byAction[a] || 0, azione);

test('oltre il limite di spesa blocco geografico, giudice anti-phishing e voce non chiamano nessun fornitore', async ({ app }) => {
  await prepara(app);
  try {
    const esito = await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      const geo = await globalThis.SN_GEO_CLASSIFY({ title: 'Forbidden', text: 'Access denied', statusCode: 403, host: 'video.cancello-prova.test', url: 'https://video.cancello-prova.test/v/1' });
      const SB = globalThis.SN_SAFEBROWSE;
      SB.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null });
      SB._caches.llmCache.m.clear();
      await Promise.all([1, 2, 3].map((i) => new Promise((ok) => {
        SB.analyze(`http://s${i}.cancello-prova.test/`, {}, ok);
        setTimeout(ok, 1500);
      })));
      const voce = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.TTS_SYNTH, text: 'Buongiorno', lang: 'it' }, {});
      return { geo, voce, chiamate: globalThis.__cancello.chiamate.slice(), limite: C.ACTIONS.GEOBLOCK_CLASSIFY };
    });
    expect(esito.geo.code).toBe('LIMIT_REACHED');
    expect(esito.geo.route.proxy).toBe(false);
    expect(esito.voce.ok).toBe(false);
    expect(String(esito.voce.error || esito.voce.reason || JSON.stringify(esito.voce))).toMatch(/limite di spesa/i);
    expect(esito.chiamate).toEqual([]);
    expect(await spesaPer(app, 'geoblock_classify')).toBe(0);
    expect(await spesaPer(app, 'safebrowse_judge')).toBe(0);
  } finally {
    await ripristina(app);
  }
});

test('sotto il limite le stesse chiamate partono e il loro costo entra nel conteggio del mese', async ({ app }) => {
  await prepara(app);
  try {
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.updateSettings({ monthlyLimitEur: 0 });
      await globalThis.SN_GEO_CLASSIFY({ title: 'Forbidden', text: 'Access denied', statusCode: 403, host: 'altro.cancello-prova.test', url: 'https://altro.cancello-prova.test/v/2' });
      const SB = globalThis.SN_SAFEBROWSE;
      SB.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null });
      SB._caches.llmCache.m.clear();
      // Sottodomini sempre nuovi dello stesso dominio: un giudizio solo.
      await Promise.all([1, 2, 3, 4, 5].map((i) => new Promise((ok) => {
        SB.analyze(`http://r${i}x.cancello-prova.test/`, {}, ok);
        setTimeout(ok, 1500);
      })));
    });
    const chiamate = await app.evaluate(() => globalThis.__cancello.chiamate.slice());
    expect(chiamate.filter((c) => c === 'testo')).toHaveLength(1);
    expect(chiamate.filter((c) => c === 'giudice')).toHaveLength(1);
    expect(await spesaPer(app, 'geoblock_classify')).toBeGreaterThan(0);
    expect(await spesaPer(app, 'safebrowse_judge')).toBeGreaterThan(0);
  } finally {
    await ripristina(app);
  }
});
