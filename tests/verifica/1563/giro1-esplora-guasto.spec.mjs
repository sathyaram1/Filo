// Esplorazione #1563: chi compatta non risponde, la chat oltre il listino risponde lo stesso e la Cronologia AI lo segna.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('chi compatta si guasta: la chat risponde, la domanda parte intera, il registro segna il listino passato', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async () => {
    const t0 = Date.now() - 3 * 60 * 60 * 1000;
    const Chats = globalThis.SN_FILO_CHATS;
    for (let i = 0; i < 6; i++) {
      await Chats.append('vecchiaG', { role: 'user', text: `Capitolo ${i}. ${'Le api bottinatrici tornano all\'alveare e danzano. '.repeat(1500)}`, ts: new Date(t0 + i * 60000).toISOString() });
      await Chats.append('vecchiaG', { role: 'filo', text: `Letto ${i}.`, ts: new Date(t0 + i * 60000 + 5000).toISOString() });
    }
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__veroG = C._dip.chiama;
    globalThis.__tentativi = 0;
    C._dip.chiama = async () => { globalThis.__tentativi++; throw new Error('402 crediti finiti'); };
  });
  await modelloFinto(app, [{ text: 'Eccomi qui.' }, { text: 'Ancora qui.' }]);
  try {
    await chiedi(page, 'di cosa parlavamo?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Eccomi qui.' })).toBeVisible({ timeout: 30000 });
    await chiedi(page, 'e poi?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ancora qui.' })).toBeVisible({ timeout: 30000 });
    const tentativi = await app.evaluate(() => globalThis.__tentativi);
    expect(tentativi, 'dopo un guasto non riprova a ogni messaggio').toBe(1);
    const [prima] = await chiamateAlModello(app);
    expect(JSON.stringify(prima.at(-1))).toContain('di cosa parlavamo?');
    const voci = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).filter((v) => v.action === 'filo_chat').map((v) => JSON.stringify(v.payload || {}).slice(0, 4000)));
    console.log('VOCI', voci.length, voci.map((v) => (v.match(/oltreListino[^,]*/) || ['-'])[0]));
  } finally {
    await app.evaluate(() => { globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__veroG; });
    await ripristina(app);
  }
});
