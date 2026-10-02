// #590.2 giro 7 — scritto il sito di una scheda aperta e passati SUBITO su quella scheda con Ctrl+Shift+Tab,
// senza pausa dopo l'ultima lettera: la scheda che si guarda è già sulla pagina «Sito bloccato».
import { test, expect, lista, apri, idAttiva, schedaSu } from '../../helpers/reteFinta.mjs';

const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;

for (const gap of [60, 150]) {
  test(`scritto il sito e Ctrl+Shift+Tab subito (${gap} ms fra Ctrl e Tab): la scheda che si guarda è bloccata`, async ({ app, shell, rete }) => {
    await lista(shell, []);
    const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
    await apri(app, shell, sito);
    const id = await idAttiva(app);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
    const pref = app.windows().find((w) => w.url().startsWith('filo://security'));
    await pref.waitForSelector('#sec-siteblock-blacklist');
    await pref.locator('#sec-siteblock-blacklist').click();
    await pref.keyboard.type('blocked.test', { delay: 30 });

    const premi = (tasti) => app.evaluate(({ BrowserWindow }, t) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      for (const e of t) tab.view.webContents.sendInputEvent(e);
    }, tasti);
    await premi([{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
    await new Promise((r) => setTimeout(r, gap));
    await premi([{ type: 'keyDown', keyCode: 'Tab', modifiers: ['control', 'shift'] }]);
    await expect.poll(() => idAttiva(app), { timeout: 2000 }).toBe(id);
    await expect.poll(async () => ((await schedaSu(app, 'blocked.test')) || {}).caricata || '', { timeout: 1500 }).toMatch(PAGINA_BLOCCATA);
  });
}
