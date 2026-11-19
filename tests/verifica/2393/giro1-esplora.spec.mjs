// Esplorazione del verificatore #2393: collegamenti trascinati col mouse vero dalla pagina sulla fila delle schede.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const PY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'gestiVeri.py');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.skip(!Gesti.disponibili(), 'servono un display X e XTest');

const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

async function nelloSchermo(app, shell, [fn, arg]) {
  const r = await shell.evaluate(fn, arg);
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + r.x * o.z), y: Math.round(o.y + r.y * o.z) };
}

// Centro della scheda i-esima, bordo fra i e i+1, il +.
const centro = (i) => () => { const r = document.querySelectorAll('.tab')[i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const bordo = (i) => () => { const a = document.querySelectorAll('.tab')[i].getBoundingClientRect(); const b = document.querySelectorAll('.tab')[i + 1].getBoundingClientRect(); return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 }; };
const piu = () => { const r = document.getElementById('tab-new').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

// Trascina tenendo fermo sull'arrivo, e intanto fotografa la shell.
async function trascinaEFoto(shell, da, a, nome, extra = []) {
  const punti = [da, a, a, a, ...extra].flatMap((p) => [p.x, p.y]);
  const p = spawn('python3', ['-I', PY, 'trascina', ...punti.map(String)], { env: process.env });
  const fine = new Promise((r) => p.on('exit', r));
  await new Promise((r) => setTimeout(r, 2600));
  if (nome) await shell.screenshot({ path: `tests/.shots/verifica-2393-${nome}.png` }).catch(() => {});
  await fine;
}

async function preparazione(app, shell, openTab, testServer, corpo) {
  const destinazione = testServer.html('<title>Video arrivato</title><h1>video</h1>');
  const img = testServer.asset(PNG, 'image/png');
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  const sorgente = await openTab(testServer.html(`<title>Sorgente</title><body style="margin:0">${corpo(destinazione, img)}</body>`));
  await expect.poll(async () => (await snap(shell)).tabs.length).toBeGreaterThanOrEqual(4);
  await Gesti.finestraASchermo(app);
  return { destinazione, sorgente };
}

const LINK = (d, img) => `<a id="l" href="${d}" style="position:absolute;left:300px;top:250px;font-size:30px">guarda il video</a>
  <a id="mini" href="${d}" style="position:absolute;left:300px;top:400px"><img src="${img}" style="width:200px;height:120px;background:#c33"></a>
  <a id="js" href="javascript:alert(1)" style="position:absolute;left:700px;top:250px;font-size:30px">script</a>
  <p id="testo" style="position:absolute;left:700px;top:400px;font-size:24px">${d}</p>`;

test('centro di una scheda dietro: ci apre il link e la porta davanti', async ({ app, shell, openTab, testServer }) => {
  const { destinazione, sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#l');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, centro(1)), 'centro');
  const bersaglio = prima.tabs[1].id;
  await expect.poll(async () => (await snap(shell)).tabs.find((t) => t.id === bersaglio)?.url, { timeout: 8000 }).toBe(destinazione);
  const dopo = await snap(shell);
  expect(dopo.activeId).toBe(bersaglio);
  expect(dopo.tabs.length).toBe(prima.tabs.length);
});

test('miniatura sul bordo fra due schede: scheda nuova in quel punto', async ({ app, shell, openTab, testServer }) => {
  const { destinazione, sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#mini img');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, bordo(1)), 'bordo');
  await expect.poll(async () => (await snap(shell)).tabs.length, { timeout: 8000 }).toBe(prima.tabs.length + 1);
  const dopo = await snap(shell);
  await expect.poll(async () => (await snap(shell)).tabs[2]?.url, { timeout: 8000 }).toBe(destinazione);
  expect(dopo.tabs[1].id).toBe(prima.tabs[1].id);
});

test('sul +: scheda nuova in fondo', async ({ app, shell, openTab, testServer }) => {
  const { destinazione, sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#l');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, piu), 'piu');
  await expect.poll(async () => (await snap(shell)).tabs.length, { timeout: 8000 }).toBe(prima.tabs.length + 1);
  await expect.poll(async () => (await snap(shell)).tabs.at(-1)?.url, { timeout: 8000 }).toBe(destinazione);
});

test('passato sopra una scheda e lasciato sulla pagina: niente cambia e il segno sparisce', async ({ app, shell, openTab, testServer }) => {
  const { sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#l');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, centro(1)), null, [{ x: da.x, y: da.y + 200 }]);
  await shell.screenshot({ path: 'tests/.shots/verifica-2393-dopo-uscita.png' });
  await new Promise((r) => setTimeout(r, 800));
  const dopo = await snap(shell);
  expect(dopo.tabs.map((t) => t.url)).toEqual(prima.tabs.map((t) => t.url));
  const segni = await shell.evaluate(() => [...document.querySelectorAll('*')].filter((n) => /link|ricev|segno|nascit/i.test(n.className?.baseVal ?? n.className ?? '')).map((n) => n.className));
  console.log('classi sospette dopo uscita', JSON.stringify(segni));
});

test('javascript: sul centro di una scheda non fa niente', async ({ app, shell, openTab, testServer }) => {
  const { sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#js');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, centro(1)), null);
  await new Promise((r) => setTimeout(r, 1000));
  const dopo = await snap(shell);
  expect(dopo.tabs.map((t) => t.url)).toEqual(prima.tabs.map((t) => t.url));
});

test('indirizzo scritto nella pagina, selezionato e trascinato su una scheda', async ({ app, shell, openTab, testServer }) => {
  const { destinazione, sorgente } = await preparazione(app, shell, openTab, testServer, LINK);
  const prima = await snap(shell);
  await sorgente.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('testo')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#testo');
  await trascinaEFoto(shell, da, await nelloSchermo(app, shell, centro(1)), 'testo');
  await new Promise((r) => setTimeout(r, 1500));
  const dopo = await snap(shell);
  console.log('testo URL selezionato: url scheda 1 =', dopo.tabs[1].url, 'attesa', destinazione, 'n', dopo.tabs.length, prima.tabs.length);
});
