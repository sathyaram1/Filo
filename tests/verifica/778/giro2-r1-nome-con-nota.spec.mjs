// #778 giro 2, rilievo 1: il modello ricopia dall'elenco la riga intera, nome più la nota che Filo ci ha attaccato
// («(in primo piano…)», «(schermo)», «(di Filo)»). È la finestra giusta: deve comparire il popup che la nomina.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';

const ESTERNA = 'Errore - Programma di prova';

async function prepara(app, giri) {
  await app.evaluate(async ({ nativeImage }, { esterna, g }) => {
    const tinta = () => nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 200), { width: 64, height: 64 });
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'win32',
      wayland: () => false,
      permessoMac: () => 'granted',
      fonti: async ({ lato = 0 } = {}) => [
        { id: 'window:4242:0', nome: esterna, tipo: 'finestra', displayId: '', immagine: lato > 0 ? tinta() : null },
        { id: 'window:4343:0', nome: 'Note - Blocco note', tipo: 'finestra', displayId: '', immagine: lato > 0 ? tinta() : null },
        { id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: '1', immagine: lato > 0 ? tinta() : null },
      ],
    });
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.DESCRIBE_IMAGE]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      schermo: { guarda: true },
    });
    globalThis.__g2_chat = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__g2_chat.push(JSON.stringify(messages));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { esterna: ESTERNA, g: giri });
}

const vedi = (id, args = {}) => ({ toolCalls: [{ id, name: 'VEDI_SCHERMO', arguments: JSON.stringify(args) }] });

test('r1 la riga dell\'elenco ricopiata intera, con la nota «in primo piano», trova la finestra e chiede l\'OK', async ({ app }) => {
  test.setTimeout(90_000);
  await prepara(app, [
    vedi('v1'),
    vedi('v2', { finestra: `${ESTERNA} (in primo piano subito dietro Filo: è «questa finestra» dell'utente)` }),
    { text: 'Non trovo la finestra.' },
  ]);
  const page = await home(app);
  await chiedi(page, 'cosa mi sta chiedendo questa finestra?');
  const chat = () => app.evaluate(() => globalThis.__g2_chat);
  await expect.poll(async () => (await chat()).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  // La nota è proprio quella che il modello ha letto nell'elenco.
  expect((await chat())[1]).toContain(`${ESTERNA} (in primo piano subito dietro Filo`);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  expect((await confirmState(page)).text).toContain(ESTERNA);
});

test('r1 «Entire screen (schermo)» ricopiato con la nota trova lo schermo', async ({ app }) => {
  test.setTimeout(90_000);
  await prepara(app, [
    vedi('v1'),
    vedi('v2', { finestra: 'Schermo intero (schermo)' }),
    { text: 'Non trovo lo schermo.' },
  ]);
  const page = await home(app);
  await chiedi(page, 'cosa c\'è sullo schermo?');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  expect((await confirmState(page)).text).toContain('Schermo intero');
});
