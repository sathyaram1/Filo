// Verifica #430 giro 2 — esplorazione: schede dietro che si ricaricano da sole, tante schede aperte dietro
// di fila, titoli strani, aspetto della carta in chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pagina, schede, idDi, carta, verde, rosso } from './giro2-carta.mjs';

function wav() {
  const sr = 8000, n = sr * 2;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * 440 / sr)), 44 + i * 2);
  return 'data:audio/wav;base64,' + b.toString('base64');
}

async function paginaDi(app, url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('scheda vista e lasciata dietro che si ricarica da sola: resta nascosta come prima', async ({ app, shell, openTab, testServer }) => {
  const suono = wav();
  const uP = testServer.html(`<!doctype html><title>Notizie</title><style>html,body{margin:0;height:100%;background:#10b010}</style>
<h1>Notizie</h1><script>
if (sessionStorage.getItem('r') === '1') {
  const a = document.createElement('audio'); a.id = 'a'; a.autoplay = true; a.loop = true; a.src = ${JSON.stringify(suono)}; document.body.appendChild(a);
} else {
  sessionStorage.setItem('r', '1');
  setTimeout(() => location.reload(), 2500);
}
</script>`);
  await openTab(uP);
  const p = await idDi(app, (t) => t.url === uP);
  await new Promise((r) => setTimeout(r, 500));
  const uQ = testServer.html(pagina('#d01010', 'Davanti'));
  await openTab(uQ);
  await idDi(app, (t) => t.url === uQ);
  const pagP = await paginaDi(app, uP);
  const prima = await pagP.evaluate(() => document.visibilityState);
  // La pagina dietro si ricarica da sola (come un sito di notizie che si aggiorna).
  await expect.poll(async () => pagP.evaluate(() => !!document.getElementById('a')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  const dopo = await pagP.evaluate(() => ({ vis: document.visibilityState, suona: !document.getElementById('a').paused }));
  const vista = await app.evaluate(({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const tab = t.tabs.find((x) => x.id === id);
    return { visibile: tab.view.getVisible ? tab.view.getVisible() : null, audible: tab.view.webContents.isCurrentlyAudible() };
  }, p);
  console.log('PRIMA', prima, 'DOPO', JSON.stringify(dopo), JSON.stringify(vista));
  // Aspetto di uno scatto finito (primo + ripresa) e riguardo.
  await new Promise((r) => setTimeout(r, 5000));
  const fine = await pagP.evaluate(() => ({ vis: document.visibilityState, suona: !document.getElementById('a').paused }));
  console.log('FINE', JSON.stringify(fine));
  expect(prima).toBe('hidden');
  expect(dopo.vis).toBe('hidden');
});

test('sei link aperti dietro di fila: ognuno ha la sua foto', async ({ app, shell, openTab, testServer }) => {
  const colori = ['#d01010', '#10b010', '#1030d0', '#d0d010', '#d010d0', '#10d0d0'];
  const urls = colori.map((c, i) => testServer.html(pagina(c, 'Pagina ' + (i + 1))));
  const links = urls.map((u, i) => `<a id="l${i}" href="${u}">link ${i + 1}</a>`).join('');
  const pA = await openTab(testServer.html(pagina('#ffffff', 'Indice', links)));
  const t0 = Date.now();
  for (let i = 0; i < urls.length; i++) await pA.click('#l' + i, { modifiers: ['Control'] });
  await expect.poll(async () => {
    const s = await schede(app);
    return urls.every((u) => s.tutte.find((t) => t.url === u)?.foto);
  }, { timeout: 30_000 }).toBe(true);
  console.log('TUTTE LE FOTO IN', Date.now() - t0, 'ms');
  const s = await schede(app);
  const id0 = s.tutte.find((t) => t.url === urls[0]).id;
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${id0}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 2000 }).toBe(true);
  const id1 = s.tutte.find((t) => t.url === urls[1]).id;
  await shell.locator(`.tab[data-id="${id1}"]`).hover();
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});

test('titolo lunghissimo con markup ed emoji, tema chiaro e scuro, ultima scheda a destra', async ({ app, shell, openTab, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const titolo = '<img src=x onerror="document.title=\'BUCATO\'"> 🍕🍕 Una pagina con un titolo davvero lunghissimo che non finisce mai e continua ancora e ancora e poi ancora';
  const u1 = testServer.html(`<!doctype html><title>${titolo.replace(/</g, '&lt;')}</title><style>html,body{margin:0;height:100%;background:#10b010}</style><h1>ciao</h1>`);
  await openTab(u1);
  const id1 = await idDi(app, (t) => t.url === u1);
  const altre = [];
  for (let i = 0; i < 9; i++) {
    const u = testServer.html(pagina(i % 2 ? '#1030d0' : '#d01010', 'Scheda ' + i));
    await openTab(u);
    altre.push(await idDi(app, (t) => t.url === u));
  }
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${id1}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const c1 = await carta(app);
  console.log('TITOLO', JSON.stringify(c1.titolo), JSON.stringify(c1.bounds));
  const win = app.windows().find((w) => { try { return w.url() === 'filo://shell/anteprima.html'; } catch (_) { return false; } });
  await shell.waitForTimeout(300);
  await win.screenshot({ path: 'tests/.shots/430-g2-chiaro-lungo.png' });
  await shell.screenshot({ path: 'tests/.shots/430-g2-shell-chiaro.png' });
  // Penultima scheda (quella davanti è l'ultima): la carta resta dentro la finestra.
  const penultima = altre[altre.length - 2];
  await shell.locator(`.tab[data-id="${penultima}"]`).hover();
  await shell.waitForTimeout(300);
  const c2 = await carta(app);
  const wb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('DESTRA', JSON.stringify(c2.bounds), JSON.stringify(wb));
  expect(c2.bounds.x + c2.bounds.width).toBeLessThanOrEqual(wb.x + wb.width);
  await win.screenshot({ path: 'tests/.shots/430-g2-chiaro-destra.png' });
  // Tema scuro.
  await shell.mouse.move(600, 500);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(800);
  await shell.locator(`.tab[data-id="${id1}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  await win.screenshot({ path: 'tests/.shots/430-g2-scuro-lungo.png' });
  await shell.screenshot({ path: 'tests/.shots/430-g2-shell-scuro.png' });
  const tit = await shell.evaluate(() => document.title);
  expect(tit).not.toBe('BUCATO');
  expect(c1.titolo).toContain('<img');
});
