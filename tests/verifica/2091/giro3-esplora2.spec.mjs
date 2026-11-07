// Esplorazione 2 del giro 3 (gesti veri a metà, titoli strani, carta del gettone di una scheda chiusa): si cancella.

import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { disponibili, finestraASchermo, sulloSchermo, trascina } from '../../helpers/gestiVeri.mjs';

const OUT = 'tests/.shots/2091-g3';
const PY = '/tmp/claude-0/-home-user-Filo/8a9d76c9-1b32-50cd-8685-9b03c0a70f7b/scratchpad/gesti.py';
const g = (...a) => execFileSync('python3', ['-I', PY, ...a.map(String)], { env: process.env });
const foto = (nome) => execFileSync('import', ['-window', 'root', `${OUT}/${nome}.png`], { env: process.env });
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;
const carte = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x.webContents.getURL().includes('anteprima.html') && x.isVisible()).length);

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z) };
}

test.describe.configure({ retries: 0 });
test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

for (const tema of ['light', 'dark']) {
  test(`E a metà trascinamento (${tema}): sopra la pagina, sopra il campo della home`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(120_000);
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const url = testServer.html('<title>Articolo sulla Tesla volante nello spazio profondo</title><p>testo');
    await openTab(url);
    const sorgente = await idPerUrl(shell, url);
    await modelloFinto(app, [{ text: 'Risposta finta.' }]);
    const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
    const casa = await home(app, { scheda: nuova?.id });
    await finestraASchermo(app);
    await casa.waitForTimeout(500);
    const da = await linguetta(app, shell, sorgente);
    const campo = await sulloSchermo(app, casa, casa, '#input');
    const prima = await casa.evaluate(() => document.body.innerHTML.length);
    g('giu', da.x, da.y);
    g('verso', da.x + 10, da.y, da.x + 60, da.y + 4);
    foto(`E-${tema}-1-sulla-fila`);
    g('verso', da.x + 60, da.y + 4, campo.x - 200, campo.y - 250);
    foto(`E-${tema}-2-sopra-pagina`);
    g('verso', campo.x - 200, campo.y - 250, campo.x, campo.y);
    foto(`E-${tema}-3-sopra-campo`);
    const durante = await casa.evaluate(() => {
      const i = document.getElementById('input');
      const cl = [];
      for (let n = i; n && n !== document.body; n = n.parentElement) cl.push(n.className);
      return { cl, out: getComputedStyle(i.parentElement).outlineStyle, box: getComputedStyle(i.parentElement).boxShadow };
    });
    console.log('DURANTE', JSON.stringify(durante));
    g('su');
    await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0), { timeout: 5000 }).toBe(1);
    const dopo = await casa.evaluate(() => {
      const i = document.getElementById('input');
      const cl = [];
      for (let n = i; n && n !== document.body; n = n.parentElement) cl.push(n.className);
      return { cl, out: getComputedStyle(i.parentElement).outlineStyle, box: getComputedStyle(i.parentElement).boxShadow };
    });
    console.log('DOPO', JSON.stringify(dopo), prima);
    await casa.locator('#input').focus();
    await casa.keyboard.type('di cosa parla');
    foto(`E-${tema}-4-gettone-nel-campo`);
    await casa.locator('#sendBtn').click();
    await expect(casa.getByText('Risposta finta.')).toBeVisible({ timeout: 10_000 });
    await casa.waitForTimeout(400);
    foto(`E-${tema}-5-gettone-nel-filo`);
  });
}

test('F titoli strani: segni del gettone nel titolo, lunghissimo, scritto a mano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const u1 = testServer.html('<title>Prezzo ⟧ offerta ⟦ speciale</title><p>Pagina-uno-segreta');
  const u2 = testServer.html(`<title>${'Lunghissimo '.repeat(60)}</title><p>Pagina-due-segreta`);
  await openTab(u1);
  await openTab(u2);
  const i1 = await idPerUrl(shell, u1);
  const i2 = await idPerUrl(shell, u2);
  await modelloFinto(app, [{ text: 'Uno.' }, { text: 'Due.' }]);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await finestraASchermo(app);
  await casa.locator('#input').fill('confronta ');
  for (const id of [i1, i2]) {
    trascina(await linguetta(app, shell, id), await sulloSchermo(app, casa, casa, '#input'));
    await casa.waitForTimeout(400);
  }
  const s = await casa.evaluate(() => ({ v: document.getElementById('input').value, n: document.getElementById('input')._snGettoni?.schede().map((x) => x.url) }));
  console.log('F-CAMPO', JSON.stringify(s));
  await casa.screenshot({ path: `${OUT}/F-campo.png` });
  await casa.locator('#sendBtn').click();
  await expect(casa.getByText('Uno.')).toBeVisible({ timeout: 10_000 });
  const c = JSON.stringify((await chiamateAlModello(app))[0]);
  console.log('F-MODELLO uno', c.includes('Pagina-uno-segreta'), 'due', c.includes('Pagina-due-segreta'));
  console.log('F-BOLLE', await casa.locator('.sn-bolla-gettone').count(), JSON.stringify(await casa.locator('.dash-bubble-user').last().innerText()));
  await casa.screenshot({ path: `${OUT}/F-filo.png` });
  await casa.locator('#input').fill('guarda ⟦ Finto gettone⟧ qui');
  await casa.locator('#sendBtn').click();
  await expect(casa.getByText('Due.')).toBeVisible({ timeout: 10_000 });
  console.log('F-MANO bolle', await casa.locator('.sn-bolla-gettone').count(), JSON.stringify(await casa.locator('.dash-bubble-user').last().innerText()));
  const c2 = (await chiamateAlModello(app))[1] || [];
  console.log('F-MANO modello', JSON.stringify(c2[c2.length - 1]).slice(0, 600));
});

test('G scheda chiusa: carta sul gettone del filo e su quello nel campo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla volante</title><p>Testo della pagina.');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  await modelloFinto(app, [{ text: 'Risposta finta.' }]);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await finestraASchermo(app);
  trascina(await linguetta(app, shell, sorgente), await sulloSchermo(app, casa, casa, '#input'));
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0), { timeout: 5000 }).toBe(1);
  await casa.locator('#sendBtn').click();
  await expect(casa.getByText('Risposta finta.')).toBeVisible({ timeout: 10_000 });
  trascina(await linguetta(app, shell, sorgente), await sulloSchermo(app, casa, casa, '#input'));
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0), { timeout: 5000 }).toBe(1);
  await shell.evaluate((i) => window.filoShell.tabs.close(i), sorgente);
  await casa.waitForTimeout(800);
  await casa.mouse.move(5, 5);
  const b = await casa.locator('.sn-bolla-gettone').first().boundingBox();
  await casa.mouse.move(b.x + 3, b.y + 3);
  await casa.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await casa.waitForTimeout(1500);
  console.log('G-CARTA-FILO', await carte(app));
  foto('G-carta-filo-chiusa');
  await casa.mouse.move(5, 5);
  await casa.waitForTimeout(600);
  const f = await casa.locator('.sn-gettone').first().boundingBox();
  await casa.mouse.move(f.x + 3, f.y + 3);
  await casa.mouse.move(f.x + f.width / 2, f.y + f.height / 2, { steps: 4 });
  await casa.waitForTimeout(1500);
  console.log('G-CARTA-CAMPO', await carte(app));
  foto('G-carta-campo-chiusa');
  await casa.mouse.move(5, 5);
  await casa.locator('#sendBtn').click();
  await casa.waitForTimeout(1500);
  const ultime = await chiamateAlModello(app);
  console.log('G-INVIO-CHIUSA', ultime.length, JSON.stringify(ultime[ultime.length - 1]?.slice(-1)).slice(0, 500));
});
