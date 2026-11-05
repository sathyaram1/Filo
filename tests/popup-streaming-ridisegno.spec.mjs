// #2119 — la risposta in streaming del riquadro si ridisegna al più una volta per fotogramma, non a ogni pezzo.
// Ogni ridisegno rifà il markdown dell'intera risposta: a ogni pezzo il costo cresce col quadrato della lunghezza.
// Si asserisce: la bolla cresce mentre arriva (anche dove rAF è fermo), con molti meno disegni che pezzi, e il testo
// finale è quello completo; un errore arrivato col disegno in attesa resta scritto.

import { test, expect } from './fixtures/electron.mjs';

const RAFFICHE = 24;
const PER_RAFFICA = 25;
const PEZZI = RAFFICHE * PER_RAFFICA;

async function preparaProvider(app) {
  await app.evaluate(async (_electron, { RAFFICHE, PER_RAFFICA }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__gateRidisegno = new Promise((res) => { globalThis.__apriGateRidisegno = res; });
    // Markdown vero (titolo, grassetto, elenco, codice) spezzato in pezzi minuti, come arriva da un modello.
    const blocco = (i) => `## Parte ${i}\n\nTesto **forte ${i}** con \`codice\` e una frase lunga abbastanza.\n\n- voce ${i}a\n- voce ${i}b\n\n\`\`\`js\nconst x${i} = ${i};\n\`\`\`\n\n`;
    const intero = Array.from({ length: RAFFICHE }, (_, i) => blocco(i + 1)).join('');
    const passo = Math.ceil(intero.length / (RAFFICHE * PER_RAFFICA));
    const pezzi = [];
    for (let i = 0; i < intero.length; i += passo) pezzi.push(intero.slice(i, i + passo));
    globalThis.__testoRidisegno = intero;
    globalThis.__pezziRidisegno = pezzi.length;
    globalThis.__origProvRidisegno = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvRidisegno,
      streamComplete: async ({ onDelta }) => {
        const meta = Math.floor(pezzi.length / 2);
        for (let i = 0; i < pezzi.length; i++) {
          if (i === meta) await globalThis.__gateRidisegno;
          onDelta(pezzi[i]);
          // Raffiche: più pezzi nello stesso giro, come quando la rete ne consegna molti insieme.
          if ((i + 1) % PER_RAFFICA === 0) await new Promise((r) => setTimeout(r, 30));
        }
        return { text: intero, usage: {} };
      },
    };
  }, { RAFFICHE, PER_RAFFICA });
}

test('la risposta lunga a tanti pezzi cresce mentre arriva, con un disegno per fotogramma, e finisce identica', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_MARKDOWN?.render, null, { timeout: 8000 });
  await preparaProvider(app);
  const { testo, pezzi } = await app.evaluate(() => ({ testo: globalThis.__testoRidisegno, pezzi: globalThis.__pezziRidisegno }));
  expect(pezzi, 'lo scenario deve avere tanti pezzi').toBeGreaterThanOrEqual(PEZZI * 0.9);

  await page.evaluate(() => {
    window.__disegni = 0;
    const orig = window.SN_MARKDOWN.render;
    window.SN_MARKDOWN.render = function (...a) { window.__disegni += 1; return orig.apply(this, a); };
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  });
  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();

  // A metà la risposta è già a schermo: il raggruppamento non rimanda tutto alla fine.
  const metaParte = `Parte ${Math.floor(RAFFICHE / 2) - 1}`;
  await expect(bolla).toContainText(metaParte, { timeout: 20_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).not.toContainText('€');

  await app.evaluate(() => { globalThis.__apriGateRidisegno?.(); });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });

  const esito = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.sn-popup .sn-msg-assistant .sn-msg-text')].pop();
    const disegni = window.__disegni;
    const atteso = window.SN_POPUP.renderMarkdown(window.SN_POPUP.resolveCalcMarkers(t));
    return { disegni, html: el.innerHTML, atteso };
  }, testo);

  // SUCCESSO: il testo finale è il markdown della risposta intera, lo stesso di sempre.
  expect(esito.html).toBe(esito.atteso);
  await expect(bolla).toContainText(`Parte ${RAFFICHE}`);
  await expect(bolla.locator('pre')).toHaveCount(RAFFICHE);
  // Senza il raggruppamento i disegni sono uno per pezzo (più quello finale).
  expect(esito.disegni, `${esito.disegni} disegni per ${pezzi} pezzi`).toBeLessThan(pezzi / 4);

  await app.evaluate(() => {
    if (globalThis.__origProvRidisegno) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origProvRidisegno;
  });
});

// La scheda che non disegna (rAF fermo, come in secondo piano) è il caso del timer di riserva: la risposta arriva lo
// stesso, e un errore arrivato prima del disegno in attesa resta scritto, non coperto dal testo parziale.
test('con la scheda che non disegna la risposta cresce lo stesso, e un errore a metà non viene coperto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming, null, { timeout: 8000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__gateErr = new Promise((res) => { globalThis.__apriGateErr = res; });
    globalThis.__origProvErr = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvErr,
      streamComplete: async ({ onDelta }) => {
        for (let i = 0; i < 10; i++) onDelta(`pezzo ${i} `);
        await globalThis.__gateErr;
        // Gli ultimi pezzi e l'errore nello stesso giro: il disegno che chiedono è ancora in attesa quando arriva l'errore.
        for (let i = 10; i < 40; i++) onDelta(`pezzo ${i} `);
        throw new Error('OpenRouter 500: guasto finto');
      },
    };
  });
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  });
  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(bolla).toContainText('pezzo 9', { timeout: 20_000 });

  await app.evaluate(() => { globalThis.__apriGateErr?.(); });
  const errore = page.locator('.sn-popup .sn-msg-assistant.sn-msg-error');
  await expect(errore).toHaveCount(1, { timeout: 20_000 });
  const testoErrore = await errore.locator('.sn-msg-text').innerText();
  expect(testoErrore.trim().length).toBeGreaterThan(0);
  // Passato il timer di riserva, l'errore è ancora lì.
  await page.waitForTimeout(400);
  await expect(errore.locator('.sn-msg-text')).toHaveText(testoErrore);
  await expect(errore.locator('.sn-msg-text')).not.toContainText('pezzo 39');

  await app.evaluate(() => {
    if (globalThis.__origProvErr) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origProvErr;
  });
});
