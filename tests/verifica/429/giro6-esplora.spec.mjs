// Verifica #429, giro 6: esplorazione (porte del giro 5 ri-provate, la richiesta in chiaro e in scuro).

import { test, expect } from '../../fixtures/electron.mjs';
import { captureCompositeElectron } from '../../agent/driver.mjs';

const CINQUE = ['filo://manage/manage.html', 'filo://admin-defaults/admin-defaults.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://downloads/downloads.html'];

async function apri(shell, urls) {
  const prima = await shell.locator('#tabs .tab').count();
  for (const u of urls) await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBe(prima + urls.length);
  await shell.waitForTimeout(1500);
}

const fila = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => {
  const ti = t.querySelector('.title'); const r = t.getBoundingClientRect();
  return { id: t.dataset.id, nome: ti.textContent, w: Math.round(r.width), x: Math.round(r.left), posto: ti.clientWidth, testo: ti.scrollWidth, attiva: t.classList.contains('active') };
}));

const centroX = (shell, id) => shell.evaluate((x) => {
  const r = document.querySelector(`#tabs .tab[data-id="${x}"] .close`).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}, id);

for (const [nome, partenza] of [['prima', 0], ['seconda', 1], ['terza', 2]]) {
  test(`esplora: chiusura di fila partendo dalla ${nome} pagina`, async ({ shell }) => {
    await apri(shell, CINQUE);
    const f0 = await fila(shell);
    console.log('FILA', JSON.stringify(f0));
    const bersaglio = f0[partenza + 1];
    const p = await centroX(shell, bersaglio.id);
    await shell.mouse.move(p.x, p.y);
    await shell.waitForTimeout(200);
    const esiti = [];
    for (let k = 0; k < 3; k++) {
      const prima = await fila(shell);
      await shell.mouse.click(p.x, p.y);
      await shell.waitForTimeout(600);
      const dopo = await fila(shell);
      esiti.push(`${prima.length}->${dopo.length} attiva=${dopo.find((s) => s.attiva)?.nome}`);
    }
    console.log('ESITI', esiti.join(' | '));
    const finale = await fila(shell);
    expect(finale.length).toBe(f0.length - 3);
  });
}

test('esplora: chiusura di fila con la scheda attiva in mezzo e Ctrl+W misto', async ({ shell }) => {
  await apri(shell, CINQUE);
  // attiva la terza (Cronologia AI)
  const f0 = await fila(shell);
  await shell.locator(`#tabs .tab[data-id="${f0[3].id}"]`).click();
  await shell.waitForTimeout(500);
  const p = await centroX(shell, f0[2].id);
  await shell.mouse.move(p.x, p.y);
  await shell.waitForTimeout(200);
  const esiti = [];
  for (let k = 0; k < 3; k++) {
    await shell.mouse.click(p.x, p.y);
    await shell.waitForTimeout(600);
    const d = await fila(shell);
    esiti.push(`${d.length} attiva=${d.find((s) => s.attiva)?.nome} [${d.map((s) => s.nome + ':' + s.w).join(',')}]`);
  }
  console.log('ESITI-ATTIVA', esiti.join(' | '));
  expect((await fila(shell)).length).toBe(f0.length - 3);
});

test('esplora: 760 px con sei schede, nomi', async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(760, 600));
  await apri(shell, CINQUE);
  await shell.waitForTimeout(800);
  const f = await fila(shell);
  console.log('760', JSON.stringify(f));
  const a = f.find((s) => s.attiva);
  expect(a.testo, `attiva «${a.nome}»`).toBeLessThanOrEqual(a.posto + 0.5);
});

for (const larg of [720, 900, 1100, 1280, 1600]) {
  test(`esplora: attiva tagliata con spazio a ${larg} px`, async ({ app, shell }) => {
    await app.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(l, 600), larg);
    await apri(shell, CINQUE);
    const tagliate = [];
    for (let i = 0; i < 6; i++) {
      const f = await fila(shell);
      await shell.locator(`#tabs .tab[data-id="${f[i].id}"]`).click();
      await shell.mouse.move(400, 400);
      await shell.waitForTimeout(500);
      const g = await fila(shell);
      const a = g.find((s) => s.attiva);
      const striscia = await shell.evaluate(() => [document.querySelector('.tab-row').getBoundingClientRect().width, document.querySelector('#tabs').getBoundingClientRect().width]);
      if (a.testo > a.posto + 0.5) tagliate.push(`${a.nome} ${a.posto}/${a.testo} riga=${striscia}`);
      console.log(larg, i, JSON.stringify(g.map((s) => `${s.nome}:${s.w}:${s.posto}/${s.testo}`)), striscia);
    }
    expect(tagliate, tagliate.join('; ')).toEqual([]);
  });
}

test('esplora: Gestione in chiaro e scuro, screenshot', async ({ app, shell, openTab }) => {
  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(1500);
  await captureCompositeElectron(app, 'tests/.shots/429-g6-chiaro.png');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(2000);
  await captureCompositeElectron(app, 'tests/.shots/429-g6-scuro.png');
  const c = await shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  const pg = await g.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log('SCURO', c, pg);
  expect(c).toBe(pg);
});
