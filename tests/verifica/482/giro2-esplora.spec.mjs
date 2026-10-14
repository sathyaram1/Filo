// #482 giro 2 — esplorazione: porte di un indirizzo fermato e aspetto dell'avviso.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });

const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).map((c) => c.textContent), testo);

test('collegamento con target=_blank a un file, e immagine dentro il collegamento', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <a href="file:///tmp/nuova-finestra.pdf" target="_blank" style="position:fixed;left:0;top:0;width:300px;height:60px;display:block">blank</a>
    <a href="file:///tmp/con-figura.pdf" style="position:fixed;left:0;top:100px;display:block"><span style="display:block;width:300px;height:60px;background:#c96">fig</span></a>
    <a id="k" href="file:///tmp/da-tastiera.pdf" style="position:fixed;left:0;top:200px;display:block">tastiera</a>`));
  await page.waitForTimeout(1000);
  await page.mouse.click(40, 30);
  await expect.poll(() => nelModello(shell, 'nuova-finestra'), { timeout: 6000 }).toHaveLength(1);
  await page.mouse.click(40, 130);
  await expect.poll(() => nelModello(shell, 'con-figura'), { timeout: 6000 }).toHaveLength(1);
  await page.focus('#k');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelModello(shell, 'da-tastiera'), { timeout: 6000 }).toHaveLength(1);
});

test('collegamento a un file dentro un riquadro della pagina', async ({ shell, openTab, testServer }) => {
  const dentro = testServer.html(`<a href="file:///tmp/nel-riquadro.pdf" style="display:block;width:300px;height:60px;background:#9c6">r</a>`);
  const page = await openTab(testServer.html(`<title>Con riquadro</title>
    <iframe src="${dentro}" style="position:fixed;left:0;top:0;width:400px;height:120px;border:0"></iframe>`));
  await page.waitForTimeout(1500);
  await page.mouse.click(40, 20);
  await expect.poll(() => nelModello(shell, 'nel-riquadro'), { timeout: 6000 }).toHaveLength(1);
});

test('collegamento a un file in una pagina di Filo (la nuova scheda)', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.some((t) => t.view.webContents.getURL().startsWith('filo://newtab'));
  })).toBe(true);
  const page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'file:///tmp/da-pagina-filo.pdf';
    a.textContent = 'x';
    a.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:60px;display:block;z-index:99999;background:#fc6';
    document.body.appendChild(a);
  });
  await page.mouse.click(40, 30);
  await expect.poll(() => nelModello(shell, 'da-pagina-filo'), { timeout: 6000 }).toHaveLength(1);
});

test('aspetto dell\'avviso, chiaro e scuro, con un percorso lunghissimo', async ({ app, shell, avvisi }) => {
  for (const tema of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await shell.evaluate((t) => window.filoShell.tabs.open(`file:///C:/Users/agenti%20AI/Documenti/Progetti/2026/clienti/${t}/una-cartella-molto-lunga-davvero/fattura-🍕-finale.pdf`), tema);
    const v = await avvisi();
    const c = v.locator('.shell-notif.show', { hasText: 'bloccato' }).last();
    await expect(c).toBeVisible({ timeout: 8000 });
    await v.waitForTimeout(500);
    await v.screenshot({ path: join(SHOTS, `482-giro2-avviso-${tema}.png`) });
    await shell.screenshot({ path: join(SHOTS, `482-giro2-shell-${tema}.png`) });
    const testi = await nelModello(shell, 'bloccato');
    console.log(tema, JSON.stringify(testi));
    await c.locator('.shell-notif-close').click();
  }
});
