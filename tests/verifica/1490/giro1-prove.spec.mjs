// Verifica #1490 giro 1: la home aperta mentre si ritocca lo zoom con i tasti, un'impostazione ritoccata più volte,
// le righe sottili strette anche in tema chiaro e accanto a un gruppo di pagine aperto.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

const cambiDelRegistro = (app) => app.evaluate(async () => (await globalThis.chrome.storage.local.get('filo_cambi')).filo_cambi || []);

test('la home già aperta: lo zoom ritoccato due volte con i tasti resta una riga, e tornato a 100 la riga sparisce', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const casa = await openTab('filo://newtab/');
  await casa.waitForLoadState('domcontentloaded');
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"><title>jazz</title></head><body><h1>jazz</h1></body></html>');
  await page.locator('h1').click();
  await page.keyboard.press('Control+Equal');
  await expect.poll(async () => (await cambiDelRegistro(app)).filter((e) => e.tipo === 'zoom').length).toBe(1);
  await page.waitForTimeout(3_000);
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(3_000);
  const righe = casa.locator('.dash-cambio', { hasText: 'zoom di' });
  await expect(righe).toHaveCount(1, { timeout: 10_000 });
  await expect(righe.locator('.dash-cambio-testo')).toHaveText(/^zoom di .+: 100% → 1[1-9]\d% · con un gesto sulla pagina$/);
  await page.keyboard.press('Control+0');
  await expect.poll(async () => (await cambiDelRegistro(app)).filter((e) => e.tipo === 'zoom').length, { timeout: 10_000 }).toBe(0);
  await expect(righe).toHaveCount(0, { timeout: 10_000 });
});

test('un’impostazione cambiata tre volte di fila dalla home è una riga sola, dal primo valore all’ultimo', async ({ app, openTab }) => {
  const casa = await openTab('filo://newtab/');
  await casa.waitForLoadState('domcontentloaded');
  const prima = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme);
  for (const t of ['dark', 'light', 'dark']) {
    await casa.evaluate((x) => self.SN_STORAGE.updateSettings({ theme: x }), t);
    await casa.waitForTimeout(400);
  }
  const ev = (await cambiDelRegistro(app)).filter((e) => e.cambi.some((c) => c.chiave === 'theme'));
  expect(ev.length).toBe(1);
  expect(ev[0].cambi.find((c) => c.chiave === 'theme').dopo).toBe('dark');
  expect(ev[0].cambi.find((c) => c.chiave === 'theme').prima ?? null).toBe(prima ?? null);
  await expect(casa.locator('.dash-cambio')).toHaveCount(1, { timeout: 10_000 });
});

test('righe sottili strette in tema chiaro, anche sotto un gruppo di pagine aperto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const t = (s) => new Date(Date.now() - s * 1000).toISOString();
    const ev = [
      E.crea(E.TIPI.NAVIGAZIONE, { url: 'https://www.youtube.com/watch?v=a', titolo: 'jazz music - YouTube' }, { ts: t(600), dispositivo: qui }),
      E.crea(E.TIPI.NAVIGAZIONE, { url: 'https://www.youtube.com/watch?v=b', titolo: 'Parisian Café Jazz' }, { ts: t(590), dispositivo: qui }),
    ];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    const R = globalThis.SN_REGISTRO_CAMBI;
    R.con({ via: 'interfaccia', dove: 'zoom' }, () => R.registraZoom({ host: 'youtube.com', prima: 125, dopo: 100 }));
    R.con({ via: 'interfaccia', dove: 'zoom' }, () => R.registraZoom({ host: 'example.com', prima: 100, dopo: 110 }));
    await R.attesa();
    await globalThis.SN_STORAGE.updateSettings({ theme: 'light' });
  });
  const casa = await openTab('filo://newtab/');
  const gruppo = casa.locator('.dash-pagine').last();
  await expect(gruppo).toBeVisible({ timeout: 10_000 });
  await gruppo.locator('.dash-pagine-testa').click();
  const righe = casa.locator('.dash-cambio');
  await expect(righe).toHaveCount(3, { timeout: 10_000 });
  const a = await righe.nth(1).boundingBox();
  const b = await righe.nth(2).boundingBox();
  expect(b.y - (a.y + a.height)).toBeLessThanOrEqual(3);
  await casa.screenshot({ path: `${SHOTS}/verifica-1490-chiaro.png` });
});
