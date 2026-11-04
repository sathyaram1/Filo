// #1695 (#1476.2) — «Riapri scheda chiusa» nel tasto destro della linguetta e del «+»: riporta l'ultima chiusa con lo
// stesso indirizzo, attiva, come Ctrl/Cmd+Shift+T; spenta, non nascosta, quando non c'è niente da riaprire.
import { test, expect } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, schede, apriEAspetta, fotoDelMenu } from './helpers/menuLinguetta.mjs';

const VOCE = 'Riapri scheda chiusa';
const voce = (voci) => voci.find((x) => x.testo === VOCE);

test('appena aperto Filo la voce c\'è ma è spenta, nella linguetta e nel +', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await tastoDestro(shell, '.tab');
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(voce(voci)).toEqual({ testo: VOCE, spenta: true });

  await shell.keyboard.press('Escape');
  await tastoDestro(shell, '#tab-new');
  const piu = await aspettaMenu(app, (v) => v.length === 1 && v[0].testo === VOCE);
  expect(piu[0].spenta).toBe(true);
});

test('dal menu della linguetta riapre la scheda chiusa, con lo stesso indirizzo e attiva', async ({ app, shell, testServer }) => {
  const resta = testServer.html('<title>Resta</title><p>resta');
  const via = testServer.html('<title>Via</title><p>via');
  await apriEAspetta(app, resta);
  const idVia = await apriEAspetta(app, via);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), idVia);
  await expect.poll(() => schede(app).then((s) => s.urls), { timeout: 8_000 }).not.toContain(via);
  const prima = await schede(app);

  await tastoDestro(shell, '.tab.active');
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(voce(voci)).toEqual({ testo: VOCE, spenta: false });
  // In fondo, vicino a «Chiudi»: le voci di prima restano al loro posto.
  const testi = voci.map((x) => x.testo);
  expect(testi.slice(0, 2)).toEqual(['Duplica', 'Muta']);
  expect(testi.indexOf(VOCE)).toBeGreaterThan(testi.indexOf('Chiudi'));
  await fotoDelMenu(app, 'tests/.shots/menu-linguetta-riapri-chiusa.png');
  await scegli(app, VOCE);

  await expect.poll(() => schede(app).then((s) => s.activeUrl), { timeout: 8_000 }).toBe(via);
  expect((await schede(app)).urls.length).toBe(prima.urls.length + 1);
});

test('dal tasto destro sul + fa la stessa cosa', async ({ app, shell, testServer }) => {
  const via = testServer.html('<title>Via</title><p>via');
  const idVia = await apriEAspetta(app, via);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), idVia);
  await expect.poll(() => schede(app).then((s) => s.urls), { timeout: 8_000 }).not.toContain(via);

  await tastoDestro(shell, '#tab-new');
  const piu = await aspettaMenu(app, (v) => v.length === 1 && v[0].testo === VOCE && !v[0].spenta);
  expect(piu).toHaveLength(1);
  await fotoDelMenu(app, 'tests/.shots/menu-piu-riapri-chiusa.png');
  await scegli(app, VOCE);

  await expect.poll(() => schede(app).then((s) => s.activeUrl), { timeout: 8_000 }).toBe(via);
});
