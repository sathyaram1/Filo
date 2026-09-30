// Verifica #431, rilievo 2: passando sull'altoparlante della scheda, il suggerimento di Filo dice il titolo, non l'azione.
import { test, expect } from '../../fixtures/electron.mjs';

test('sull\'altoparlante il suggerimento di Filo dice Silenzia, sul muto Riattiva audio', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tips431 = [];
    ipcMain.on('shell:tooltip-show', (_e, d) => globalThis.__tips431.push(d && d.text));
  });
  await openTab(testServer.html('<title>Musica di sottofondo</title>'));
  await openTab(testServer.html('<title>Podcast</title>'));
  // Giro 2: la barra si ridimensiona mentre arrivano i titoli; si passa col puntatore solo a barra ferma.
  await expect(shell.locator('.tab .title')).toHaveText(['Home', 'Musica di sottofondo', 'Podcast'], { timeout: 10_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  const ferma = async (loc) => {
    let prima = null;
    await expect.poll(async () => {
      const ora = JSON.stringify(await loc.boundingBox());
      const uguale = ora === prima;
      prima = ora;
      return uguale;
    }, { timeout: 5000, intervals: [200] }).toBe(true);
  };
  const [suona, muta] = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    Object.assign(web[0], { audible: true, loading: false });
    Object.assign(web[1], { muted: true, loading: false });
    w._filoTabs._broadcast();
    return [web[0].id, web[1].id];
  });
  const ultimo = () => app.evaluate(() => globalThis.__tips431[globalThis.__tips431.length - 1] || '');

  const altoparlante = shell.locator(`.tab[data-id="${suona}"] .audio-ind`);
  await expect(altoparlante).toHaveCount(1, { timeout: 10_000 });
  await ferma(altoparlante);
  await shell.mouse.move(5, 200);
  await altoparlante.hover();
  await expect.poll(ultimo, { timeout: 3000 }).toMatch(/silenzia/i);

  const muto = shell.locator(`.tab[data-id="${muta}"] .mute-ind`);
  await expect(muto).toHaveCount(1);
  await shell.mouse.move(5, 200);
  await muto.hover();
  await expect.poll(ultimo, { timeout: 3000 }).toMatch(/riattiva/i);
});
