// Verifica #1290.2 giro 1, rilievo 3: di serie un riquadro da un pixel spento del tutto (display:none) va al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { stubTranslationProvider, watchToasts, toasts, clickTranslateIcon, sentText, frameInner, framePage } from './aiuti.mjs';

test('r3 di serie un riquadro da un pixel spento con display:none non va al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const cross = (token) => testServer.html(frameInner(token)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`
    <iframe src="${cross('ZZNONE')}" width="1" height="1" style="display:none"></iframe>
    <iframe id="big" src="${cross('ZZBIG')}" style="opacity:0;width:520px;height:220px"></iframe>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  // Il riquadro nascosto grande si traduce in sottofondo: è il metro che dice che il giro è arrivato fin lì.
  await expect.poll(async () => (await sentText(app)).includes('ZZBIG'), { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(await sentText(app)).not.toContain('ZZNONE');
});
