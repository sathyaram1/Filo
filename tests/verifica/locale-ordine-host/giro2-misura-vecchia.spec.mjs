// La misura del «Prova» ora resta dopo il ricaricamento. Qui si guarda a COSA
// resta attaccata: se segue il nickname e non il modello misurato, cambiare
// modello lascia sullo schermo un numero che parla di un altro modello.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const ESITO = /TTFT\s+\d/;

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__misuraVecchiaAttivo) return;
    globalThis.__misuraVecchiaAttivo = true;
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":9},"provider":"Baseten"}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

async function rigaDelNickname(page, nick) {
  const selettore = '#modelRegistryList .sn-model-row:not(.sn-model-row-head)';
  await page.waitForSelector(selettore, { timeout: 15_000 });
  const indice = await page.evaluate(([sel, n]) => {
    const righe = Array.from(document.querySelectorAll(sel));
    return righe.findIndex((r) => {
      const el = r.querySelector('.sn-model-nick');
      return el && el.value === n;
    });
  }, [selettore, nick]);
  if (indice < 0) throw new Error(`riga "${nick}" non trovata`);
  return page.locator(selettore).nth(indice);
}

test('cambiando il modello di una riga la misura di prima non resta a parlare del nuovo', async ({ app, openTab }) => {
  test.fail(true, 'rilievo aperto: la misura segue il nickname, non il modello misurato');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'finto/primo' } },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  let riga = await rigaDelNickname(page, 'mio');
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  // L'utente riscrive la stringa del modello: da qui in poi la riga è un ALTRO
  // modello, e la misura di prima non lo riguarda più.
  await riga.locator('.sn-model-id').fill('finto/secondo');
  await riga.locator('.sn-model-id').dispatchEvent('change');
  await page.waitForTimeout(1200);
  await page.reload();

  riga = await rigaDelNickname(page, 'mio');
  const modello = await riga.locator('.sn-model-id').inputValue();
  expect(modello, 'il modello nuovo non è stato salvato').toBe('finto/secondo');
  const stato = (await riga.locator('.sn-model-row-status').textContent()) || '';
  expect(stato,
    `la riga mostra ancora la misura del modello di prima: «${stato.trim()}»`)
    .not.toMatch(ESITO);
});
