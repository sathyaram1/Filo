// Verifica #482 giro 1: esplorazione delle porte non coperte dallo spec del lavoro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).length, testo);
const carta = async (avvisi, testo) => (await avvisi()).locator('.shell-notif.show', { hasText: testo });
const esterni = (app) => app.evaluate(() => globalThis.__esterni || []);
const intercettaEsterni = (app) => app.evaluate(({ shell }) => {
  globalThis.__esterni = [];
  shell.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
});

test('tastiera: Invio su un collegamento a un file lo dice', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>T</title>
    <a id="f" href="file:///C:/Dati/tastiera.pdf">tastiera</a>`));
  await page.waitForTimeout(600);
  await page.locator('#f').focus();
  await page.keyboard.press('Enter');
  await expect(await carta(avvisi, 'tastiera.pdf')).toBeVisible({ timeout: 8000 });
});

test('clic su un elemento dentro il collegamento lo dice', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>T</title>
    <a href="file:///C:/Dati/dentro.pdf" style="display:block;width:300px;height:60px"><span id="s" style="display:block;width:300px;height:60px">dentro</span></a>`));
  await page.waitForTimeout(600);
  const b = await page.locator('#s').boundingBox();
  await page.mouse.click(b.x + 20, b.y + 20);
  await expect(await carta(avvisi, 'dentro.pdf')).toBeVisible({ timeout: 8000 });
});

test('osserva: pulsante che naviga a file: da script, window.open, data:', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>T</title>
    <button id="b1" style="display:block;width:300px;height:40px" onclick="location.href='file:///C:/Dati/script.pdf'">uno</button>
    <button id="b2" style="display:block;width:300px;height:40px" onclick="window.open('file:///C:/Dati/finestra.pdf')">due</button>
    <a id="d" href="data:text/html,ciao" style="display:block;width:300px;height:40px">dati</a>`));
  await page.waitForTimeout(600);
  await page.locator('#b1').click();
  await page.waitForTimeout(1200);
  console.log('script.pdf', await nelModello(shell, 'script.pdf'));
  await page.locator('#b2').click();
  await page.waitForTimeout(1200);
  console.log('finestra.pdf', await nelModello(shell, 'finestra.pdf'));
  await page.locator('#d').click();
  await page.waitForTimeout(1200);
  console.log('data', await nelModello(shell, 'data:'), page.url());
});

test('rinavigando, tel: e MAILTO maiuscolo vanno al sistema', async ({ app, shell }) => {
  await intercettaEsterni(app);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs[0].id);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'tel:+39 333 1234567'), [id]);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'MAILTO:x@y.it'), [id]);
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['tel:+39 333 1234567', 'MAILTO:x@y.it']);
  expect(await nelModello(shell, 'bloccat')).toBe(0);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await shell.emulateMedia({ colorScheme: tema });
    await shell.evaluate(() => window.filoShell.tabs.open('file:///C:/Users/agenti%20AI/Documenti/Progetti%202026/Clienti/Rossi%20Mario/preventivo%20definitivo%20firmato.pdf'));
    const c = await carta(avvisi, 'preventivo');
    await expect(c).toBeVisible({ timeout: 8000 });
    await shell.waitForTimeout(500);
    const v = await avvisi();
    await v.emulateMedia({ colorScheme: tema });
    await shell.waitForTimeout(300);
    mkdirSync('tests/.shots', { recursive: true });
    const { BrowserWindow } = {};
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    });
    const fs = await import('node:fs');
    fs.writeFileSync(`tests/.shots/482-shell-${tema}.png`, Buffer.from(png, 'base64'));
    await v.screenshot({ path: `tests/.shots/482-avvisi-${tema}.png` });
    console.log('testo', await c.textContent());
  });
}
