// Verifica #430 giro 1 — esplorazione: la carta di anteprima al passaggio sulle schede.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-430';
mkdirSync(SHOTS, { recursive: true });

const pagina = (colore, titolo, corpo = '') => `<!doctype html><title>${titolo}</title>
<style>html,body{margin:0;height:100%;background:${colore}}</style>
<h1 style="margin:0;padding:40px;font:40px sans-serif">${titolo}</h1>${corpo}`;

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, title: x.title, loading: x.loading, foto: !!t.anteprime.get(x.id) })) };
  });
}
async function idDi(app, pred, timeout = 15_000) {
  let id = null;
  await expect.poll(async () => {
    const s = await schede(app);
    const t = s.tutte.find(pred);
    id = t && !t.loading ? t.id : null;
    return !!id;
  }, { timeout }).toBe(true);
  return id;
}
async function carta(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return { esiste: false, visibile: false };
    const dom = await c.webContents.executeJavaScript(`(() => {
      const carta = document.getElementById('carta');
      const img = document.querySelector('#foto img');
      const r = img ? img.getBoundingClientRect() : null;
      return {
        mostrata: !carta.hidden,
        larghezza: carta.getBoundingClientRect().width,
        titolo: document.getElementById('titolo').textContent,
        indirizzo: document.getElementById('indirizzo').textContent,
        pronta: !!img && img.complete && img.naturalWidth > 0,
        foto: r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.8 } : null,
        dpr: devicePixelRatio,
      };
    })()`);
    let colore = null;
    if (dom.foto && dom.mostrata) {
      const shot = await c.webContents.capturePage();
      const s = shot.getSize();
      const px = Math.round(dom.foto.x * dom.dpr);
      const py = Math.round(dom.foto.y * dom.dpr);
      if (px < s.width && py < s.height) {
        const b = shot.toBitmap();
        const i = (py * s.width + px) * 4;
        colore = [b[i + 2], b[i + 1], b[i]];
      }
    }
    return { esiste: true, visibile: c.isVisible(), bounds: c.getBounds(), ...dom, colore };
  });
}
const tinta = (c) => {
  if (!c) return 'nessuna';
  const [r, g, b] = c;
  if (r > 180 && g < 90 && b < 90) return 'rossa';
  if (b > 180 && r < 90 && g < 120) return 'blu';
  if (g > 150 && r < 100 && b < 100) return 'verde';
  if (r > 200 && g > 200 && b < 90) return 'gialla';
  return `altro(${c.join(',')})`;
};
async function fotoCarta(app, file) {
  await app.evaluate(async ({ BrowserWindow }, f) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return;
    const img = await c.webContents.capturePage();
    require('fs').writeFileSync(f, img.toPNG());
  }, `${process.cwd()}/${SHOTS}/${file}`);
}

test('E1 pagina cambiata mentre era davanti: la carta mostra lo stato di quando l\'ho lasciata', async ({ app, shell, openTab, testServer }) => {
  const uA = testServer.html(pagina('#d01010', 'Rossa'));
  const pA = await openTab(uA);
  const a = await idDi(app, (t) => t.url === uA);
  await pA.waitForTimeout(500);
  await pA.evaluate(() => { document.body.style.background = '#10b010'; document.documentElement.style.background = '#10b010'; });
  await pA.waitForTimeout(300);
  const uB = testServer.html(pagina('#1030d0', 'Blu'));
  await openTab(uB);
  const b = await idDi(app, (t) => t.url === uB);
  await expect.poll(async () => (await schede(app)).attiva).toBe(b);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === a).foto, { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  console.log('E1', JSON.stringify(c));
  expect(tinta(c.colore)).toBe('verde');
});

test('E2 cambio rapido di scheda col clic: ogni scheda lasciata ha la sua foto giusta', async ({ app, shell, openTab, testServer }) => {
  const ids = [];
  const colori = ['#d01010', '#1030d0', '#10b010', '#e0e010'];
  const nomi = ['rossa', 'blu', 'verde', 'gialla'];
  for (let i = 0; i < 4; i++) {
    const u = testServer.html(pagina(colori[i], nomi[i]));
    await openTab(u);
    ids.push(await idDi(app, (t) => t.url === u));
  }
  // clic rapidi sulla barra
  for (const id of [ids[0], ids[1], ids[2], ids[0], ids[3]]) {
    await shell.locator(`.tab[data-id="${id}"]`).click();
    await shell.waitForTimeout(60);
  }
  await expect.poll(async () => (await schede(app)).attiva).toBe(ids[3]);
  await shell.waitForTimeout(800);
  const esiti = [];
  for (let i = 0; i < 3; i++) {
    await shell.locator('#tab-new').hover().catch(() => {});
    await shell.mouse.move(5, 300);
    await shell.waitForTimeout(800);
    await shell.locator(`.tab[data-id="${ids[i]}"]`).hover();
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    await shell.waitForTimeout(150);
    const c = await carta(app);
    esiti.push([nomi[i], tinta(c.colore), c.titolo]);
  }
  console.log('E2', JSON.stringify(esiti));
  for (const [n, t] of esiti) expect(t).toBe(n);
});

test('E3 pagina interna aperta dietro e schede con titolo HTML/lungo/emoji', async ({ app, shell, openTab, testServer }) => {
  const lungo = 'Titolo lunghissimo '.repeat(30) + ' 😀🎉';
  const uX = testServer.html(pagina('#d01010', '&lt;img src=x onerror=alert(1)&gt;<b>grassetto</b>'));
  await openTab(uX);
  const x = await idDi(app, (t) => t.url === uX);
  const uL = testServer.html(pagina('#1030d0', lungo));
  await openTab(uL);
  const l = await idDi(app, (t) => t.url === uL);
  await openTab('filo://manage/manage.html').catch(() => {});
  const m = await idDi(app, (t) => /manage/.test(t.url));
  const uB = testServer.html(pagina('#10b010', 'Verde'));
  await openTab(uB);
  await idDi(app, (t) => t.url === uB);
  await shell.waitForTimeout(1000);
  for (const [id, nome] of [[x, 'html'], [l, 'lungo'], [m, 'manage']]) {
    await shell.mouse.move(5, 400);
    await shell.waitForTimeout(700);
    await shell.locator(`.tab[data-id="${id}"]`).hover();
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    await shell.waitForTimeout(200);
    const c = await carta(app);
    console.log('E3', nome, JSON.stringify({ ...c, titolo: c.titolo.slice(0, 80) }));
    await fotoCarta(app, `e3-${nome}.png`);
    expect(c.pronta).toBe(true);
  }
});

test('E4 tempo fra hover e carta con foto', async ({ app, shell, openTab, testServer }) => {
  const uA = testServer.html(pagina('#d01010', 'Rossa'));
  await openTab(uA);
  const a = await idDi(app, (t) => t.url === uA);
  const uB = testServer.html(pagina('#1030d0', 'Blu'));
  await openTab(uB);
  await idDi(app, (t) => t.url === uB);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === a).foto, { timeout: 10_000 }).toBe(true);
  // prima volta in assoluto nella sessione: il puntatore entra nella barra e va dritto sulla scheda
  const box = await shell.locator(`.tab[data-id="${a}"]`).boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const t0 = Date.now();
  let t1 = null;
  while (Date.now() - t0 < 3000) {
    const c = await carta(app);
    if (c.visibile && c.mostrata && c.pronta) { t1 = Date.now(); break; }
    await shell.waitForTimeout(20);
  }
  console.log('E4 ms', t1 && t1 - t0);
  expect(t1).not.toBeNull();
});
