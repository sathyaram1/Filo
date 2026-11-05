import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const ORA_MS = 60 * 60 * 1000;
test('esplora attesa durante la compattazione', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async (_e, ore) => {
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 3 * ore;
    const capitolo = (i) => `Capitolo ${i} della tesi sulle api. ${'Le api bottinatrici tornano all\'alveare e danzano. '.repeat(1700)}`;
    for (let i = 0; i < 3; i++) {
      await Chats.append('vecchia1', { role: 'user', text: capitolo(i), ts: new Date(t0 + i * 60000).toISOString() });
      await Chats.append('vecchia1', { role: 'filo', text: `Letto il capitolo ${i}.`, ts: new Date(t0 + i * 60000 + 5000).toISOString() });
    }
  }, ORA_MS);
  await modelloFinto(app, [{ text: 'Sì, ricordo la tesi sulle api.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__v = C._dip.chiama;
    C._dip.chiama = async () => { await new Promise((r) => setTimeout(r, 8000)); return JSON.stringify({ ore: [{ testo: '09:00 tesi' }], memorie: [] }); };
  });
  try {
    await chiedi(page, 'ti ricordi la mia tesi?');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/.shots/giro3-attesa.png' });
    const txt = await page.locator('body').innerText();
    console.log('DURANTE', JSON.stringify(txt.slice(-600)));
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/.shots/giro3-stop.png' });
    await page.waitForTimeout(8000);
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    const t2 = await page.locator('body').innerText();
    console.log('DOPO', JSON.stringify(t2.slice(-700, -350)));
  } finally {
    await app.evaluate(() => { globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__v; });
    await ripristina(app);
  }
});
