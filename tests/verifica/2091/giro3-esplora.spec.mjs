// Esplorazione del giro 3 con gesti veri del sistema (XTest): si cancella prima del verdetto.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { disponibili, finestraASchermo, sulloSchermo, trascina } from '../../helpers/gestiVeri.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const OUT = 'tests/.shots/2091-g3';
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const attiva = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1, w: cb.width, h: cb.height };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z), win: o };
}

test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

test('A home: gettone, carta, invio, clic, scheda chiusa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla volante</title><p>Testo-segreto-2091 della pagina: la Roadster nello spazio.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  await modelloFinto(app, [{ text: 'Risposta finta.' }, { text: 'Seconda.' }]);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await finestraASchermo(app);
  await casa.locator('#input').fill('come ha fatto a volare? ');
  const da = await linguetta(app, shell, sorgente);
  const a = await sulloSchermo(app, casa, casa, '#input');
  trascina(da, a);
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0), { timeout: 5000 }).toBe(1);
  console.log('VALORE', JSON.stringify(await casa.locator('#input').inputValue()));
  await casa.screenshot({ path: `${OUT}/A-campo.png` });
  console.log('GETTONI-CAMPO', await casa.locator('.sn-gettone').count());
  await casa.locator('.sn-gettone').first().hover();
  await casa.waitForTimeout(1200);
  const carta = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x.webContents.getURL().includes('anteprima.html') && x.isVisible()).length);
  console.log('CARTA-CAMPO', carta);
  await casa.mouse.move(5, 5);
  await casa.locator('#sendBtn').click();
  await expect(casa.getByText('Risposta finta.')).toBeVisible({ timeout: 10_000 });
  const chiamate = await chiamateAlModello(app);
  const ultimo = JSON.stringify(chiamate[0]);
  console.log('MODELLO titolo', ultimo.includes('Articolo sulla Tesla volante'), 'url', ultimo.includes(url), 'testo', ultimo.includes('Testo-segreto-2091'));
  await expect(casa.locator('.sn-bolla-gettone')).toHaveCount(1);
  await casa.screenshot({ path: `${OUT}/A-filo.png` });
  // Secondo turno: la lettura resta?
  await casa.locator('#input').fill('e chi l\'ha lanciata?');
  await casa.locator('#sendBtn').click();
  await expect(casa.getByText('Seconda.')).toBeVisible({ timeout: 10_000 });
  const c2 = JSON.stringify((await chiamateAlModello(app))[1] || []);
  console.log('SECONDO-TURNO testo', c2.includes('Testo-segreto-2091'));
  // Clic sul gettone di una scheda aperta: la porta davanti.
  await casa.locator('.sn-bolla-gettone').first().click();
  await expect.poll(() => attiva(shell), { timeout: 5000 }).toBe(sorgente);
  // Chiudi la scheda, torna alla home: il gettone resta, hover e clic.
  await shell.evaluate((i) => window.filoShell.tabs.close(i), sorgente);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), nuova.id);
  await expect(casa.locator('.sn-bolla-gettone')).toHaveCount(1);
  await casa.locator('.sn-bolla-gettone').first().hover();
  await casa.waitForTimeout(1200);
  const carta2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x.webContents.getURL().includes('anteprima.html') && x.isVisible()).length);
  console.log('CARTA-CHIUSA', carta2);
  await casa.locator('.sn-bolla-gettone').first().click();
  await expect.poll(async () => (await schede(shell)).some((t) => t.url === url), { timeout: 5000 }).toBe(true);
});

test('B campi di una pagina: textarea, input testo, input url, contenteditable, titolo con markup', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Ricetta &lt;img src=x onerror=window.__x=1&gt; del pane 🍞</title><p>farina');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const titolo = (await schede(shell)).find((t) => t.id === sorgente).title;
  console.log('TITOLO', titolo);
  const pagina = await openTab(testServer.html(`<title>Moduli</title>
    <textarea id="t" style="width:300px;height:60px">Ciao </textarea><br>
    <input id="s" type="text" style="width:300px" value="testo: "><br>
    <input id="u" type="url" style="width:300px"><br>
    <input id="e" type="email" style="width:300px"><br>
    <div id="c" contenteditable="true" style="width:300px;height:60px;border:1px solid">scritto </div>`));
  await finestraASchermo(app);
  for (const sel of ['#t', '#s', '#u', '#c', '#e']) {
    const da = await linguetta(app, shell, sorgente);
    const a = await sulloSchermo(app, pagina, pagina, sel);
    trascina(da, a);
    await pagina.waitForTimeout(600);
  }
  const v = await pagina.evaluate(() => ({ t: t.value, s: s.value, u: u.value, e: e.value, c: c.innerHTML, x: window.__x || 0 }));
  console.log('CAMPI', JSON.stringify(v, null, 1));
  console.log('ATTIVA', await attiva(shell), 'ordine', JSON.stringify((await schede(shell)).map((t) => t.id)));
});

test('C sopra la pagina, fuori dalla finestra, fuori e dentro: niente, ordine invariato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const errori = [];
  shell.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  shell.on('pageerror', (e) => errori.push(String(e)));
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  const pagina = await openTab(testServer.html('<title>Tre</title><p>tre'));
  await finestraASchermo(app);
  const prima = (await schede(shell)).map((t) => t.id);
  const id = prima[1];
  const da = await linguetta(app, shell, id);
  const p = await sulloSchermo(app, pagina, pagina, 'p');
  trascina(da, { x: p.x + 200, y: p.y + 200 });
  await shell.waitForTimeout(500);
  console.log('SOPRA-PAGINA', JSON.stringify((await schede(shell)).map((t) => t.id)) === JSON.stringify(prima));
  const da2 = await linguetta(app, shell, id);
  trascina(da2, { x: da2.win.x + da2.win.w + 150, y: da2.y + 300 });
  await shell.waitForTimeout(500);
  console.log('FUORI', JSON.stringify((await schede(shell)).map((t) => t.id)) === JSON.stringify(prima), 'finestre', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs).length));
  // Fuori dalla fila, sopra la pagina, e ritorno sulla fila oltre l'ultima: l'ordine deve cambiare.
  const da3 = await linguetta(app, shell, prima[0]);
  const ultima = await linguetta(app, shell, prima[prima.length - 1]);
  trascina(da3, { x: p.x + 100, y: p.y + 250 }, { x: ultima.x + 30, y: ultima.y });
  await shell.waitForTimeout(500);
  console.log('FUORI-E-DENTRO', JSON.stringify((await schede(shell)).map((t) => t.id)), 'prima', JSON.stringify(prima));
  console.log('ERRORI', JSON.stringify(errori));
  await shell.screenshot({ path: `${OUT}/C-dopo.png` });
});

test('D Aiuto su un sito: rilascio, carta, clic sul gettone', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  const id = await attiva(shell);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await finestraASchermo(app);
  const r = await aiuto.locator('.sn-sidebar-input textarea').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 }; });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const s = tm.riquadri.strati.get(t.view.webContents);
    const cb = w.getContentBounds();
    return { cb, b: s.perIlVuoto.getBounds(), z: s.vista.webContents.getZoomFactor() || 1 };
  });
  const a = { x: Math.round(v.cb.x + v.b.x + r.x * v.z), y: Math.round(v.cb.y + v.b.y + r.y * v.z) };
  trascina(await linguetta(app, shell, sorgente), a);
  await expect(aiuto.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });
  await aiuto.locator('.sn-gettoni-fondo .sn-gettone').first().hover();
  await aiuto.waitForTimeout(1200);
  const carta = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x.webContents.getURL().includes('anteprima.html') && x.isVisible()).map((x) => x.getBounds()));
  console.log('CARTA-AIUTO', JSON.stringify(carta));
  await sito.screenshot({ path: `${OUT}/D-aiuto.png` });
  await aiuto.locator('.sn-gettoni-fondo .sn-gettone').first().click();
  await aiuto.waitForTimeout(800);
  console.log('CLIC-AIUTO attiva sorgente', (await attiva(shell)) === sorgente);
});
