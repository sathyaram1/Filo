// Giro 21, rilievo 1 (#1589): a «Chiedi sempre» aprire il tasto destro su una parola sconosciuta di un campo non
// deve mandare il testo scritto al modello: aprire il menu non è una richiesta, come per immagini e link.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PUBBLICO = 'sito-pubblico.test';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test.use({ hostInPiu: [PUBBLICO] });

test('r1 a «Chiedi sempre» il tasto destro su una parola di una casella non manda il testo al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      security: { privacy: { livello: 'sempre' } },
    });
    globalThis.__mandato = [];
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({ text: '[]', provider: 'openrouter', model: (attempts && attempts[0] && attempts[0].model) || 'stub', usage: {} });
    P.completeWithFallback = async ({ messages, attempts }) => { globalThis.__mandato.push(JSON.stringify(messages)); return risposta(attempts); };
    P.streamCompleteWithFallback = async ({ messages, attempts }) => { globalThis.__mandato.push(JSON.stringify(messages)); return risposta(attempts); };
  });
  const url = testServer.html(`<!doctype html><title>Cerca</title><body style="padding:30px">
    <input id="q" style="width:600px;font:20px monospace;padding:4px"></body>`).replace('127.0.0.1', PUBBLICO);
  const pagina = await openTab(url);
  await pagina.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  const testo = 'risultati esami Mario Rossi famigla';
  await pagina.locator('#q').click();
  await pagina.keyboard.type(testo, { delay: 20 });
  await pausa(2000);
  const conTesto = () => app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('Mario Rossi')).length);
  expect(await conTesto(), 'scrivendo non parte niente').toBe(0);

  // Il clic destro sulla parola sconosciuta, a metà di «famigla».
  const punto = await pagina.evaluate((t) => {
    const el = document.getElementById('q');
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.font;
    const r = el.getBoundingClientRect();
    const x = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + c.measureText(t.slice(0, t.length - 3)).width;
    return { x, y: r.top + r.height / 2 };
  }, testo);
  await pagina.mouse.click(punto.x, punto.y, { button: 'right' });
  await expect(menuDi(pagina).principale).toBeVisible({ timeout: 10_000 });
  await pausa(2500);
  expect(await conTesto(), 'aperto il menu, il testo del campo non è partito').toBe(0);
});
