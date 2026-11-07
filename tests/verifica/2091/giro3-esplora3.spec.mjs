// Esplorazione 3 del giro 3: due rilasci di fila nella home, gesto spezzato senza foto. Si cancella.

import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { disponibili, finestraASchermo, sulloSchermo, trascina } from '../../helpers/gestiVeri.mjs';

const OUT = 'tests/.shots/2091-g3';
const PY = '/tmp/claude-0/-home-user-Filo/8a9d76c9-1b32-50cd-8685-9b03c0a70f7b/scratchpad/gesti.py';
const g = (...a) => execFileSync('python3', ['-I', PY, ...a.map(String)], { env: process.env });
const foto = (nome) => execFileSync('import', ['-window', 'root', `${OUT}/${nome}.png`], { env: process.env });
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;
const n = (casa) => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0);

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

async function prepara(app, shell, openTab, testServer) {
  const u1 = testServer.html('<title>Primo articolo</title><p>uno');
  const u2 = testServer.html('<title>Secondo articolo</title><p>due');
  await openTab(u1);
  await openTab(u2);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await finestraASchermo(app);
  await casa.waitForTimeout(400);
  return { casa, i1: await idPerUrl(shell, u1), i2: await idPerUrl(shell, u2) };
}

test('H due rilasci di fila nella home', async ({ app, shell, openTab, testServer }) => {
  const { casa, i1, i2 } = await prepara(app, shell, openTab, testServer);
  trascina(await linguetta(app, shell, i1), await sulloSchermo(app, casa, casa, '#input'));
  await casa.waitForTimeout(800);
  console.log('H-DOPO-1', await n(casa));
  trascina(await linguetta(app, shell, i2), await sulloSchermo(app, casa, casa, '#input'));
  await casa.waitForTimeout(800);
  console.log('H-DOPO-2', await n(casa));
  foto('H-dopo-2');
  trascina(await linguetta(app, shell, i2), await sulloSchermo(app, casa, casa, '#input'));
  await casa.waitForTimeout(800);
  console.log('H-DOPO-3', await n(casa));
});

test('H2 due rilasci con un clic altrove fra i due', async ({ app, shell, openTab, testServer }) => {
  const { casa, i1, i2 } = await prepara(app, shell, openTab, testServer);
  trascina(await linguetta(app, shell, i1), await sulloSchermo(app, casa, casa, '#input'));
  await casa.waitForTimeout(800);
  console.log('H2-DOPO-1', await n(casa));
  await shell.evaluate(() => document.activeElement && document.activeElement.blur());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).webContents.focus());
  await casa.waitForTimeout(300);
  trascina(await linguetta(app, shell, i2), await sulloSchermo(app, casa, casa, '#input'));
  await casa.waitForTimeout(800);
  console.log('H2-DOPO-2', await n(casa));
});

test('I gesto spezzato in tre processi, senza foto', async ({ app, shell, openTab, testServer }) => {
  const { casa, i1 } = await prepara(app, shell, openTab, testServer);
  const da = await linguetta(app, shell, i1);
  const campo = await sulloSchermo(app, casa, casa, '#input');
  g('giu', da.x, da.y);
  g('verso', da.x + 10, da.y, da.x + 60, da.y + 4);
  g('verso', da.x + 60, da.y + 4, campo.x - 200, campo.y - 250);
  const durante = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.className + '|' + t.style.transform + '|' + getComputedStyle(t).opacity));
  console.log('I-DURANTE', JSON.stringify(durante));
  g('verso', campo.x - 200, campo.y - 250, campo.x, campo.y);
  g('su');
  await casa.waitForTimeout(800);
  console.log('I-DOPO', await n(casa));
});
