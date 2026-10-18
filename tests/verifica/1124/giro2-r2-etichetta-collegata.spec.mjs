// r2: un campo il cui nome visibile «Email» gli è collegato con aria-labelledby riceve la proposta come quello con <label>.
import { test, expect } from '../../fixtures/electron.mjs';
import { accountFinto, mostrata } from './aiuti.mjs';

test('r2 il campo con l\'etichetta «Email address» collegata per aria-labelledby riceve la proposta', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px">
    <span id="lb">Email address</span><br><input type="text" id="f1" aria-labelledby="lb" style="width:280px"></body>`);
  await page.click('#f1');
  await expect.poll(() => mostrata(app), { timeout: 5000 }).toBe(true);
});
