// #1664 — sull'Aiuto di un sito l'utente dà un'immagine e chiede di mandarla come segnalazione: la conferma la mostra in
// miniatura, parte se tenuta e resta se tolta. Il modello finto risponde dal main, come quello vero; deposito finto.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { cartellaInCasa } from './helpers/percorsi.mjs';
import { neiRiquadri, paginaDellAiuto, confermaNelloStrato } from './helpers/riquadri.mjs';
import { confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from './helpers/confirm.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';

async function lascia(page, files) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 200, y: 200, data });
  await s.detach().catch(() => {});
}

async function prepara(app, allegati) {
  await app.evaluate(async (_e, allegati) => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__depositati = [];
    FB.submit = async (p) => { globalThis.__depositati.push(JSON.parse(JSON.stringify(p))); return { id: 'fb-1' }; };
    const risposta = {
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', titolo: 'Menu tagliato', testo: 'Il menu del sito esce dallo schermo.', allegati },
      text: 'Preparo la segnalazione con la tua immagine.',
    };
    const finta = async ({ attempts, messages }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      return { ...base, text: sistema.includes('# Protocollo di risposta') ? JSON.stringify(risposta) : '{}' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finta;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finta;
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, allegati);
}

async function chiediConImmagine(app, openTab, testServer) {
  const foto = join(cartellaInCasa('filo-aiuto-segnala-'), 'schermata.png');
  writeFileSync(foto, PNG);
  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [foto]);
  await expect.poll(() => neiRiquadri(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length), { timeout: 8_000 }).toBe(1);
  const A = await paginaDellAiuto(app, page);
  await A.keyboard.type('manda questa immagine come segnalazione');
  await A.keyboard.press('Enter');
  const strato = await confermaNelloStrato(app, page, { timeout: 20_000 });
  await expect.poll(async () => (await confirmState(strato))?.allegati?.length).toBe(1);
  return strato;
}

const depositati = (app) => app.evaluate(() => globalThis.__depositati || []);

test('l’immagine data all’Aiuto si vede nella conferma e parte con la segnalazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, ['1', '4']);
  const strato = await chiediConImmagine(app, openTab, testServer);
  const s = await confirmState(strato);
  expect(s.allegati[0]).toMatchObject({ id: 'immagine:1', tolto: false, immagine: true });
  expect(s.notaAllegati).toContain('immagine 4');
  await strato.screenshot({ path: 'tests/.shots/aiuto-segnala-con-immagine.png' });
  await aspettaConfermaPronta(strato);
  await scrollConfirmToEnd(strato);
  await clickConfirm(strato, 'ok');

  await expect.poll(async () => (await depositati(app)).length, { timeout: 20_000 }).toBe(1);
  const [p] = await depositati(app);
  expect(p.text).toContain('Il menu del sito esce dallo schermo.');
  expect(p.images).toHaveLength(1);
  expect(p.images[0].dataUrl).toMatch(/^data:image\/png;base64,/);
});

test('un’immagine tolta nella conferma dell’Aiuto non parte, la segnalazione sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, ['1']);
  const strato = await chiediConImmagine(app, openTab, testServer);
  expect(await strato.evaluate(() => window.SN_CONFIRM_UI._test.allegato('immagine:1'))).toBe(true);
  expect((await confirmState(strato)).allegati[0].tolto).toBe(true);
  await aspettaConfermaPronta(strato);
  await scrollConfirmToEnd(strato);
  await clickConfirm(strato, 'ok');

  await expect.poll(async () => (await depositati(app)).length, { timeout: 20_000 }).toBe(1);
  const [p] = await depositati(app);
  expect(p.images || []).toHaveLength(0);
  expect(p.text).toContain('Il menu del sito esce dallo schermo.');
});
