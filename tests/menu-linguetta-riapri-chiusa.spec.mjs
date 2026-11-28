// #1695 (#1476.2) — «Riapri scheda chiusa» nel tasto destro del «+»: riporta l'ultima chiusa con lo stesso indirizzo,
// attiva, come Ctrl/Cmd+Shift+T; spenta, non nascosta, quando non c'è niente da riaprire. Sulla linguetta non c'è:
// non è un'azione su quella scheda (#2087).
import { test, expect } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, schede, apriEAspetta, fotoDelMenu } from './helpers/menuLinguetta.mjs';

const VOCE = 'Riapri scheda chiusa';

test('appena aperto Filo la voce del + c\'è ma è spenta; la linguetta non ce l\'ha', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await tastoDestro(shell, '.tab');
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(voci.some((x) => x.testo === VOCE)).toBe(false);

  await tastoDestro(shell, '#tab-new');
  const piu = await aspettaMenu(app, (v) => v.length === 1 && v[0].testo === VOCE);
  expect(piu[0].spenta).toBe(true);
});

test('dal tasto destro sul + riapre la scheda chiusa, con lo stesso indirizzo e attiva', async ({ app, shell, testServer }) => {
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
