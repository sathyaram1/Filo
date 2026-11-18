// Verifica #1803 giro 1: le schede trascinate sulla barra dei siti che non diventano voci, e il doppione muto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const attiva = (shell, id) => shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
const salvate = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti || []);

async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
}
async function puntoInPagina(app, page, selettore) {
  const r = await page.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}
// Una scheda presa dalla fila col mouse vero e lasciata sulla barra dei siti della home.
async function lasciaSullaBarra(app, shell, page, idScheda) {
  const verso = await puntoInPagina(app, page, '#barraRiga');
  const da = await linguetta(shell, idScheda);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
}
// Un avviso della home, o un cambio d'aspetto della voce che c'è già (non della riga, che s'illumina a ogni passaggio).
const ascoltaSegnali = (page) => page.evaluate(() => {
  window.__segnali = 0;
  new MutationObserver((cambi) => {
    const segno = (c) => {
      const e = c.target.nodeType === 1 ? c.target : c.target.parentElement;
      if (e && (e.closest('#dashFlash') || (e.closest('.dash-barra-voce[data-tipo]') && c.type === 'attributes'))) return true;
      return [...c.addedNodes].some((n) => n.id === 'dashFlash' || (n.closest && n.closest('.dash-barra-voce[data-tipo]')));
    };
    if (cambi.some(segno)) window.__segnali++;
  }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
});

test('r1 una scheda di una pagina di Filo trascinata sulla barra diventa una voce', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://history/');
  const t = (await schede(shell)).find((x) => String(x.url).startsWith('filo://history'));
  const casa = (await schede(shell)).find((x) => String(x.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  await expect(page.locator('#barraSiti .dash-barra-piu')).toBeVisible();
  await lasciaSullaBarra(app, shell, page, t.id);
  await expect(page.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1, { timeout: 5000 });
  await expect.poll(async () => (await salvate(app)).length).toBe(1);
});

test('r2 lasciare sulla barra un sito che c\'è già dà un segno', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html('<title>Doppio</title><p>x</p>');
  await openTab(url);
  const t = (await schede(shell)).find((x) => x.url === url);
  const casa = (await schede(shell)).find((x) => String(x.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  await lasciaSullaBarra(app, shell, page, t.id);
  await expect(page.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(800);
  await ascoltaSegnali(page);
  await lasciaSullaBarra(app, shell, page, t.id);
  await expect(page.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__segnali), { timeout: 3000 }).toBeGreaterThan(0);
});
