// #502 — leggere la risposta MENTRE arriva.
//
// Il corpo del riquadro della spiegazione è una finestrella che scorre, e da
// quando la posa gli stringe il tetto allo spazio disponibile si accorcia
// parecchio: leggere scorrendo è il modo normale di usarla. Ma il riquadro
// portava la vista in fondo a ogni pezzo di risposta che arrivava, quindi chi
// tornava su a rileggere veniva sbalzato giù di nuovo — e a ogni pezzo, cioè
// non poteva rileggere finché il modello non aveva finito.
//
// La regola di Filo è già scritta
// (patterns/liste-chat-che-si-ricostruiscono-in-streaming-auto-follow.md):
// si segue il fondo solo se l'utente ci era
// rimasto, altrimenti la lettura si lascia dov'è.
//
// SUCCESSO che si asserisce: scrollato su durante la generazione, a risposta
// finita la vista è ancora dov'era l'utente. E l'invariante da non regredire:
// restando in fondo, la vista continua a SEGUIRE la risposta che arriva.
//
// Senza il rimedio il primo test è rosso: `scrollTop` torna in fondo al primo
// pezzo che arriva dopo lo scroll.

import { test, expect } from './fixtures/electron.mjs';

// Provider finto con un "gate": manda una prima metà di risposta (abbastanza da
// far traboccare il corpo, così scrollare ha senso), poi si ferma finché il
// test non lo lascia proseguire — è lì che l'utente scrolla su a rileggere —
// e infine manda la seconda metà, che è quella che gli strappava la vista.
async function preparaProviderConGate(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__gatePopupScroll = new Promise((res) => { globalThis.__apriGatePopupScroll = res; });
    const paragrafo = (i) => `Paragrafo ${i}: una spiegazione distesa della parola selezionata, con abbastanza testo da far traboccare il corpo del riquadro e renderlo scorrevole. `;
    const primi = Array.from({ length: 14 }, (_, i) => paragrafo(i + 1));
    const dopo = Array.from({ length: 14 }, (_, i) => paragrafo(i + 15));
    globalThis.__origGemScroll = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origGemScroll,
      streamComplete: async ({ onDelta }) => {
        for (const p of primi) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 20));
        }
        await globalThis.__gatePopupScroll;
        for (const p of dopo) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 40));
        }
        return { text: [...primi, ...dopo].join(''), usage: {} };
      },
    };
  });
}

async function apriGate(app) {
  await app.evaluate(() => { globalThis.__apriGatePopupScroll?.(); });
}

async function ripristinaProvider(app) {
  await app.evaluate(() => {
    if (globalThis.__origGemScroll) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origGemScroll;
  });
}

const scrollInfo = (page) => page.evaluate(() => {
  const el = document.querySelector('.sn-popup-body');
  if (!el) return null;
  return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
});

// Apre il riquadro come Alt+E su una parola, e aspetta che il corpo sia
// diventato scorrevole: prima di quel momento non c'è niente da scorrere e il
// test non proverebbe niente.
async function riquadroCheScorre(app, page) {
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );
  await preparaProviderConGate(app);
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect.poll(
    async () => { const s = await scrollInfo(page); return s ? s.height - s.client : 0; },
    { timeout: 20_000, message: 'il corpo non è mai diventato scorrevole: lo scenario non è quello vero' },
  ).toBeGreaterThan(80);
}

test('scrollando su per rileggere mentre la risposta arriva, la vista NON torna in fondo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await riquadroCheScorre(app, page);

  // L'utente torna su a rileggere un pezzo, mentre la risposta sta ancora
  // arrivando.
  await page.evaluate(() => { document.querySelector('.sn-popup-body').scrollTop = 0; });
  await expect.poll(async () => (await scrollInfo(page)).top).toBeLessThan(20);

  // Arriva il resto della risposta: prima del rimedio era il primo pezzo a
  // riportare la vista in fondo, e poi ogni pezzo successivo.
  await apriGate(app);
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });

  const s = await scrollInfo(page);
  expect(s.height - s.client, 'il corpo non è più scorrevole: il test non prova niente').toBeGreaterThan(80);
  // SUCCESSO — la lettura è rimasta dove l'aveva lasciata l'utente.
  expect(s.top, 'la risposta che arriva ha strappato la lettura in fondo').toBeLessThan(20);

  await ripristinaProvider(app);
});

test('restando in fondo, la vista continua a seguire la risposta che arriva', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await riquadroCheScorre(app, page);

  // Non tocco niente: l'utente è in fondo e guarda la risposta comparire.
  await apriGate(app);
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });

  const s = await scrollInfo(page);
  expect(s.height - s.client, 'il corpo non è più scorrevole: il test non prova niente').toBeGreaterThan(80);
  // SUCCESSO — l'auto-follow non è regredito: chi resta in fondo vede l'ultima
  // riga senza dover scorrere.
  expect(s.height - s.top - s.client, 'restando in fondo la vista non ha seguito la risposta')
    .toBeLessThan(8);

  await ripristinaProvider(app);
});
