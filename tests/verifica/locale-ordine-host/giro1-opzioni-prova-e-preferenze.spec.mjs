// Verifica delle due richieste in coda: l'esito del tasto «Prova» nelle Opzioni
// deve restare visibile dopo il ricaricamento, e la conferma «Salvato» delle
// Preferenze deve riferirsi all'ultima modifica.
//
// Il router non si chiama mai: le richieste si intercettano nel processo main.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const PREFERENZE = 'filo://preferences/preferences.html';
const ESITO = /TTFT\s+\d/;

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__ordineHostAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__ordineHostAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
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

// La riga del registry personale con quel nickname: il valore dei campi non sta
// nell'attributo HTML, quindi l'indice si cerca leggendo le caselle.
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
  if (indice < 0) throw new Error(`riga "${nick}" non trovata nel registry personale`);
  return page.locator(selettore).nth(indice);
}

test('Opzioni, con i modelli predefiniti accesi: l\'esito della prova resta dopo il ricaricamento', async ({ app, openTab }) => {
  test.fail(true, 'rilievo aperto: la misura resta solo sui modelli propri, non sui predefiniti');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  await page.waitForSelector('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  const riga = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  await page.reload();
  await page.waitForSelector('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  const dopo = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await expect(dopo.locator('.sn-model-row-status'), 'la misura della prova è sparita col ricaricamento').toHaveText(ESITO, { timeout: 10_000 });
});

test('Opzioni, con i modelli propri: l\'esito della prova resta dopo il ricaricamento', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'finto/mio', sort: 'throughput', reasoning: 'high' } },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  let riga = await rigaDelNickname(page, 'mio');
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  await page.reload();
  riga = await rigaDelNickname(page, 'mio');
  await expect(riga.locator('.sn-model-row-status'), 'la misura della prova è sparita col ricaricamento').toHaveText(ESITO, { timeout: 10_000 });
});

test('Preferenze: la conferma «Salvato» non resta accesa su una modifica precedente', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto: la conferma delle Preferenze parla ancora della modifica di prima');

  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  const scrivi = async (testo) => page.evaluate((t) => {
    const el = document.getElementById('agentStyleText');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, testo);

  // Prima modifica: passata l'attesa, la conferma compare.
  await scrivi('primo testo');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });

  // Seconda modifica, mentre la conferma di prima è ancora sullo schermo: quella
  // conferma parla di uno stato superato e deve sparire finché il nuovo non è
  // salvato, altrimenti chi chiude la pagina crede al sicuro qualcosa che non lo è.
  await scrivi('secondo testo, non ancora salvato');
  const accesaSubito = await page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show'));
  expect(accesaSubito, 'la conferma «Salvato» resta accesa mentre l\'ultima modifica non è ancora salvata').toBe(false);
});

// Perché la conferma che mente conta: quella modifica può davvero non essere
// salvata. Chi scrive e lascia subito la pagina la perde, e la conferma accesa
// gli ha appena detto il contrario.
test('Preferenze: la modifica scritta appena prima di lasciare la pagina non si perde', async ({ app, openTab }) => {
  test.fail(true, 'rilievo aperto: le Preferenze non salvano prima di sparire, le Opzioni sì');
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.evaluate(() => {
    const el = document.getElementById('agentStyleText');
    el.value = 'stile scritto appena prima di uscire';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).agentStyle || '');
  expect(salvato, 'lasciare la pagina subito dopo aver scritto butta via l\'ultima modifica')
    .toBe('stile scritto appena prima di uscire');
});

test('Opzioni: la modifica scritta appena prima di lasciare la pagina non si perde', async ({ app, openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.evaluate(() => {
    const el = document.getElementById('monthlyLimit');
    el.value = '13';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.reload();
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });

  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).monthlyLimitEur);
  expect(salvato, 'lasciare la pagina subito dopo aver scritto butta via l\'ultima modifica').toBe(13);
});

test('Opzioni: la conferma «Salvato» sparisce appena arriva un\'altra modifica', async ({ openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });

  const cambia = async (valore) => page.evaluate((v) => {
    const el = document.getElementById('monthlyLimit');
    el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, valore);

  await cambia(7);
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });

  await cambia(9);
  const accesaSubito = await page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show'));
  expect(accesaSubito, 'la conferma resta accesa mentre l\'ultima modifica non è salvata').toBe(false);
});
