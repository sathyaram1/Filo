// Verifica #431 giro 4, rilievo 1: col tema scuro, su una scheda dietro tinta di un colore chiaro, titolo e avviso audio non si leggono.
import { test, expect } from '../../fixtures/electron.mjs';

test('tema scuro: titolo e altoparlante di una scheda dietro con tinta chiara restano leggibili', async ({ app, shell, openTab, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  await openTab(testServer.html('<title>Musica - Sito chiaro</title>'));
  await openTab(testServer.html('<title>Davanti</title>'));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  const id = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    Object.assign(t, { audible: true, identityColor: 'rgb(240, 240, 240)' });
    w._filoTabs._broadcast();
    return t.id;
  });
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await shell.mouse.move(600, 400);
  const contrasti = await tab.evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgb = (css) => { c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (p) => { const [r, g, b] = p.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const fondo = rgb(getComputedStyle(el).backgroundColor);
    return {
      titolo: ratio(rgb(getComputedStyle(el.querySelector('.title')).color), fondo),
      avviso: ratio(rgb(getComputedStyle(el.querySelector('.tab-alert')).color), fondo),
    };
  });
  expect(contrasti.titolo).toBeGreaterThanOrEqual(3);
  expect(contrasti.avviso).toBeGreaterThanOrEqual(3);
});
