// Esplorazione del verificatore #2393, seconda parte: schermo intero, voce della barra dei siti, file dal computer.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function nelloSchermo(app, shell, [fn, arg]) {
  const r = await shell.evaluate(fn, arg);
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + r.x * o.z), y: Math.round(o.y + r.y * o.z) };
}
const centro = (i) => () => { const r = document.querySelectorAll('.tab')[i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

test('voce della barra dei siti della home portata sul centro di una scheda', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'gesti');
  const destinazione = testServer.html('<title>Sito della barra</title><p>ok');
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  const page = await home(app);
  await page.locator('#barraSiti').click({ button: 'right', position: { x: 200, y: 10 } });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Aggiungi sito…' }).click();
  await page.locator('.dash-barra-campo input').fill(destinazione);
  await page.keyboard.press('Enter');
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]');
  await expect(voce).toHaveCount(1);
  const prima = await snap(shell);
  const indice = prima.tabs.findIndex((t) => t.url.includes('127.0.0.1') && t.id !== prima.activeId);
  await Gesti.finestraASchermo(app);
  const da = await Gesti.sulloSchermo(app, page, page, '#barraSiti .dash-barra-voce[data-tipo="sito"]');
  Gesti.trascina(da, await nelloSchermo(app, shell, centro(indice)));
  await expect.poll(async () => (await snap(shell)).tabs[indice].url, { timeout: 8000 }).toBe(destinazione);
  const casa = await home(app).catch(() => null);
  if (casa) console.log('voci dopo:', await casa.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]').count());
});

test('a schermo intero: link portato contro il bordo alto, le schede scendono e lo ricevono', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'gesti');
  const destinazione = testServer.html('<title>Video arrivato</title><p>ok');
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  const sorgente = await testServer.openReady(openTab, `<title>S</title><body style="margin:0"><a id="l" href="${destinazione}" style="position:absolute;left:300px;top:300px;font-size:30px">video</a>`);
  await Gesti.finestraASchermo(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#l');
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).getContentBounds());
  const alto = { x: da.x, y: cb.y + 1 };
  // Il punto della seconda scheda lo si conosce solo a fila scesa: la stessa x della scheda, a mezza altezza della fila.
  const r = await shell.evaluate(() => { const r = document.querySelectorAll('.tab')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, h: document.querySelector('.tab-row').getBoundingClientRect().height }; });
  const scheda = { x: cb.x + Math.round(r.x), y: cb.y + Math.round(r.h / 2) };
  Gesti.trascina(da, alto, alto, alto, scheda, scheda);
  await expect.poll(async () => (await snap(shell)).tabs.find((t) => t.id === prima.tabs[1].id)?.url, { timeout: 8000 }).toBe(destinazione);
});

test('file immagine dal computer lasciato sul centro di una scheda va alla chat come prima (sintetico)', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  const prima = await snap(shell);
  const esito = await shell.evaluate(() => {
    const t = document.querySelectorAll('.tab')[1];
    const r = t.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'foto.png', { type: 'image/png' }));
    dt.setData('text/uri-list', 'file:///home/utente/foto.png');
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt };
    t.dispatchEvent(new DragEvent('dragenter', o));
    const over = new DragEvent('dragover', o); t.dispatchEvent(over);
    const drop = new DragEvent('drop', o); t.dispatchEvent(drop);
    return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, tipi: [...dt.types] };
  });
  console.log('file sintetico', JSON.stringify(esito));
  await pausa(1500);
  const dopo = await snap(shell);
  console.log('schede dopo', JSON.stringify(dopo.tabs.map((t) => t.url)), 'attiva', dopo.activeId === prima.activeId);
});
