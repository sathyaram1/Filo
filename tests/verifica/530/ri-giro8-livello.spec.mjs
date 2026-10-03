// Verifica #530 giro 8, rilievo 2: chiesto in chat, Filo sa a che livello di autonomia sta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('il modello sa il livello di autonomia scelto: a Conservativo il prompt lo dice', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  await modelloFinto(app, [{ text: 'Ok.' }]);
  try {
    await chiedi(page, 'a che livello di autonomia sei adesso?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15000 }).toBeGreaterThan(0);
    const prompt = JSON.stringify((await chiamateAlModello(app))[0]);
    expect(prompt, 'il prompt nomina il livello attivo').toMatch(/Conservativo/);
  } finally {
    await ripristina(app);
  }
});
