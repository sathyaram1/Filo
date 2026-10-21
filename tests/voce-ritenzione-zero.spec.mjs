// #831: coi crediti di Filo la lettura ad alta voce di un modello che nessun host a ritenzione zero serve non parte,
// e l'avviso è la frase condivisa delle altre funzioni (funzione, modello, motivo, dove sceglierne un altro).
// Regole pure: tests/unit/ritenzioneZero.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

// A pesi aperti: una voce che i crediti non pagano si ferma prima, con la frase sua (#830, crediti-solo-politica.spec.mjs).
const VOCE = 'hexgrad/kokoro-82m';

// Il router finto nel main: DeepInfra è l'unico host della voce e il catalogo a ritenzione zero non lo elenca.
async function preparaRouter(app, sorgente) {
  await app.evaluate(async (_e, { VOCE, sorgente }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'voce-x': { provider: 'openrouter', model: VOCE } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.TTS]: 'voce-x' },
    });
    // Chi paga lo dice il portafoglio: qui si finge la chiave dei crediti o quella propria.
    globalThis.SN_WALLET_MAIN.keySourceOf = async () => sorgente;
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__voci = 0;
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/api/v1/endpoints/zdr')) return json({ data: [{ name: 'Altro | altro/modello', provider_name: 'Altro', tag: 'altro' }] });
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) return json({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
      if (u.includes('openrouter.ai/api/v1/audio/speech')) {
        globalThis.__voci++;
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000' } });
      }
      return globalThis.__fetchVero(url, init);
    };
  }, { VOCE, sorgente });
}

const leggi = (app) => app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
  { type: globalThis.SN_MSG.MSG.TTS_SYNTH, text: 'ciao a tutti' },
  { url: 'https://example.com/' },
).then((x) => x, (e) => ({ ok: false, error: e.message, code: e.code })));

test('coi crediti la voce senza host a ritenzione zero non parte, e la frase dice funzione, modello, motivo e dove cambiarlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, 'personal');
  const r = await leggi(app);
  expect(await app.evaluate(() => globalThis.__voci)).toBe(0);
  expect(r.ok).toBe(false);
  expect(r.errorCode).toBe('NO_ALLOWED_HOST');
  expect(r.error).toBe(`La funzione «Lettura ad alta voce (sintesi vocale)» non può usare «${VOCE}» perché nessun fornitore ammesso lo ospita senza conservare i dati, e coi crediti di Filo è una condizione. Lo serve solo DeepInfra, che non si impegna a non conservarli. Scegline un altro in Opzioni → Modelli per azione.`);
});

test('con la chiave propria la stessa voce parte: decide l\'utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, 'own');
  const r = await leggi(app);
  expect(r.ok).toBe(true);
  expect(await app.evaluate(() => globalThis.__voci)).toBe(1);
});
