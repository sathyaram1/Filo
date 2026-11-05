// Il costo che il router dice solo dopo (tentativo rotto a metà, risposta interrotta senza conto) entra nella voce di
// «Cronologia delle richieste AI» del turno, anche quando nessun tentativo ha risposto (#1302). Router finto nel main.
import { test, expect } from './fixtures/electron.mjs';

const COSTI = { 'g-rotta': 0.002, 'g-tronca': 0.003, 'g-ritentata': 0.004 };

async function routerFinto(app) {
  await app.evaluate(async (_e, costi) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test-tardivi' },
      modelRegistry: T.registry, models: { ...T.models },
    });
    const vero = globalThis.fetch;
    const enc = new TextEncoder();
    const riga = (o) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
    globalThis.__ritentata = 0;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('openrouter.ai/api/v1/generation')) {
        const id = new URL(u).searchParams.get('id');
        return new Response(JSON.stringify({ data: { provider_name: 'DeepInfra', total_cost: costi[id] || 0 } }), { status: 200 });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const testo = String(init.body);
      const caso = ['rotta', 'tronca', 'ritentata'].find((c) => testo.includes(`caso-${c}`));
      const id = `g-${caso}`;
      const flusso = new ReadableStream({
        start(c) {
          c.enqueue(riga({ id, choices: [{ delta: { reasoning: 'ci penso a lungo' } }] }));
          if (caso === 'rotta') {
            c.enqueue(riga({ id, error: { code: 502, message: 'Provider disconnected' }, choices: [{ delta: {}, finish_reason: 'error' }] }));
          } else if (caso === 'tronca') {
            c.enqueue(riga({ id, choices: [{ delta: { content: 'Ecco la mia ' } }] }));
            c.enqueue(riga({ id, error: { code: 502, message: 'Provider disconnected' }, choices: [{ delta: {}, finish_reason: 'error' }] }));
          } else if (globalThis.__ritentata++ === 0) {
            // Il primo giro cade a metà per la rete: si ritenta da solo, e il tentativo rotto si è pagato lo stesso.
            c.error(new TypeError('fetch failed'));
            return;
          } else {
            c.enqueue(riga({ id: 'g-buona', choices: [{ delta: { content: 'Ecco.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 } }));
          }
          c.close();
        },
      });
      return new Response(flusso, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, COSTI);
}

const chiedi = (app, caso, via) => app.evaluate(async (_e, { caso: c, via: v }) => {
  const H = globalThis.__filoHandlers;
  const C = globalThis.SN_CONST;
  const richiesta = { action: C.ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: `caso-${c}` }] }, origin: 'test' };
  const fai = v === 'stream' ? H.handleStream({ ...richiesta, onDelta: () => {}, onReset: () => {} }) : H.handleAIRequest({ ...richiesta, onText: () => {} });
  return fai.then(() => 'ok', (e) => e.code || e.message);
}, { caso, via });

const costoInCronologia = (app, caso) => app.evaluate(async (_e, c) => {
  const voci = (await globalThis.SN_HISTORY.list()).filter((it) => JSON.stringify(it.input || '').includes(`caso-${c}`));
  return voci.length === 1 ? voci[0].costEur : `voci: ${voci.length}`;
}, caso);

test('i costi detti dopo entrano nella voce del turno, anche quando nessun tentativo ha risposto', async ({ app }) => {
  test.setTimeout(90_000);
  await routerFinto(app);
  const eur = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).usdToEur || 1);

  expect(await chiedi(app, 'rotta', 'richiesta'), 'il fornitore si ferma durante il ragionamento').not.toBe('ok');
  await chiedi(app, 'tronca', 'stream');
  expect(await chiedi(app, 'ritentata', 'richiesta')).toBe('ok');

  const vicino = (atteso) => (v) => typeof v === 'number' && Math.abs(v - atteso) < 1e-9;
  await expect.poll(() => costoInCronologia(app, 'rotta'), { timeout: 30_000 }).toSatisfy(vicino(0.002 * eur));
  await expect.poll(() => costoInCronologia(app, 'tronca'), { timeout: 30_000 }).toSatisfy(vicino(0.003 * eur));
  await expect.poll(() => costoInCronologia(app, 'ritentata'), { timeout: 30_000 }).toSatisfy(vicino((0.004 + 0.001) * eur));
});
