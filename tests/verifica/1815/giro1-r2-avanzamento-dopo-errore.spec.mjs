// Verifica #1815 giro 1: quando la trascrizione dal tasto destro si ferma per un errore, il riquadro non dice più
// «Trascrivo: 0 di 1» come se stesse ancora lavorando.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

function wav(secondi) {
  const sr = 8000;
  const n = Math.round(sr * secondi);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i / 3)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test('r2 crediti finiti: il riquadro dice l\'errore e smette di dire «Trascrivo: n di m»', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits","code":402}}');
      e.status = 402;
      throw e;
    };
  });
  const src = testServer.asset(wav(5), 'audio/wav');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <audio id="a" src="${src}" controls style="display:block;width:320px"></audio></body></html>`);
  await page.locator('#a').click({ button: 'right', position: { x: 10, y: 10 } });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await menu.voce('Trascrivi').click();
  const riquadro = async () => (await statoDi(app, page, '.sn-popup'))?.testo || '';
  await expect.poll(riquadro, { timeout: 30_000 }).toMatch(/crediti sono finiti/);
  await page.waitForTimeout(1500);
  expect(await riquadro()).not.toMatch(/Trascrivo: \d+ di \d+/);
});
