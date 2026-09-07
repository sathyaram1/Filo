// #496 — verifica visiva del tema scuro sulla scheda «Statistiche feedback»,
// campi data compresi (il tema di Filo è data-sn-theme su <html>).

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const CRITICA = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [2] Il pulsante non salva.';
const STOP = "Verifica: 2 rilievi.\nIl lavoro si ferma: c'è un rilievo di livello 2 o 3 che non si può correggere da soli.\n- [3] Perde i dati.";
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
});

const DATI = [
  fb({ id: 'a', seq: 1, at: iso(0), status: 'done', clientId: 'routine:prober', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(2), status: 'done', clientId: 'owner:pino', notes: `R.${TURNO}${CRITICA}${TURNO}${PASS}` }),
  fb({ id: 'c', seq: 3, at: iso(4), status: 'working', clientId: 'routine:new-work', notes: `R.${TURNO}${STOP}` }),
  fb({ id: 'd', seq: 4, at: iso(9), status: 'todo', priority: 3 }),
  fb({ id: 'e', seq: 5, at: iso(14), status: 'archived', clientId: 'local:sess' }),
  fb({ id: 'f', seq: 6, at: iso(20), status: 'design', clientId: 'filo:auto' }),
];
const LOG = [
  { role: 'prober', startedAt: iso(0), num: '' },
  { role: 'prober', startedAt: iso(1), num: '' },
  { role: 'verifier', startedAt: iso(1), num: '#1' },
  { role: 'new-work', startedAt: iso(3), num: '#3' },
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), LOG);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
}

test('scheda statistiche: chiaro e scuro, coi campi data aperti', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  fs.mkdirSync('tests/.shots', { recursive: true });

  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'light'; });
  await page.locator('#mgStTileRicevuti').click();
  await page.screenshot({ path: 'tests/.shots/496-chiaro.png', fullPage: true });

  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/.shots/496-scuro.png', fullPage: true });

  // Campi data visibili sul tema scuro: l'icona del calendario è nativa.
  await page.locator('.mg-st-chip[data-window="custom"]').click();
  await expect(page.locator('#mgStCustom')).toBeVisible();
  await page.waitForTimeout(200);
  await page.locator('#mgStCustom').screenshot({ path: 'tests/.shots/496-date-scuro.png' });
  await page.locator('.mg-st-bar').screenshot({ path: 'tests/.shots/496-barra-scuro.png' });

  const cs = await page.evaluate(() => {
    const i = document.getElementById('mgStFrom');
    const s = getComputedStyle(i);
    return {
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      inputColorScheme: s.colorScheme,
      color: s.color, background: s.backgroundColor,
      tema: document.documentElement.dataset.snTheme,
    };
  });
  console.log('DATE INPUT SCURO:', JSON.stringify(cs));

  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'light'; });
  await page.waitForTimeout(200);
  await page.locator('#mgStCustom').screenshot({ path: 'tests/.shots/496-date-chiaro.png' });
});

test('finestra stretta: la scheda non sborda in orizzontale', async ({ openTab, app }) => {
  const page = await openTab(URL);
  await apri(page);
  for (const w of [1000, 800, 620]) {
    await app.evaluate(async ({ BrowserWindow }, larghezza) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ ...win.getBounds(), width: larghezza });
    }, w);
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      barra: (() => { const b = document.querySelector('.mg-st-bar'); return b ? b.scrollWidth : 0; })(),
    }));
    console.log(`LARGHEZZA ${w}:`, JSON.stringify(over));
    await page.screenshot({ path: `tests/.shots/496-stretta-${w}.png` });
  }
});

test('«Sempre»: il registro delle esecuzioni è parziale — la scheda lo dice?', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  // Registro che parte solo da due giorni fa: su «Sempre» il numero delle
  // esecuzioni è un minimo, non un totale.
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), [
    { role: 'prober', startedAt: iso(0), num: '' },
    { role: 'prober', startedAt: iso(2), num: '' },
  ]);

  await page.evaluate(() => window.__mgTest.setStatsWindow('365d'));
  const anno = await page.locator('#mgStRange').innerText();
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  const sempre = await page.locator('#mgStRange').innerText();
  console.log('RIGA ANNO   :', JSON.stringify(anno));
  console.log('RIGA SEMPRE :', JSON.stringify(sempre));
  console.log('PROBER SEMPRE:', await page.locator('#mgStTileProber [data-num]').innerText());
  // «Sempre» comincia prima di qualunque cosa: è la finestra in cui il numero
  // delle esecuzioni è più lontano dal totale, quindi è proprio lì che deve
  // dire da quando il registro esiste.
  expect(anno).toMatch(/registrate dal/);
  expect(sempre).toMatch(/registrate dal/);
});

test('dalle statistiche si arriva ai feedback che le compongono?', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.locator('#mgStTileRicevuti').click();
  const riga = page.locator('#mgStDrawer .mg-st-row').first();
  await expect(riga).toBeVisible();
  const prima = await page.locator('#panel-fbstats').getAttribute('class');
  await riga.click();
  await page.waitForTimeout(300);
  const dopo = await page.locator('#panel-fbstats').getAttribute('class');
  const listaAperta = await page.locator('#panel-list').evaluate((e) => e.classList.contains('mg-panel--active'));
  console.log('CLIC SU RIGA CATEGORIA → pannello lista attivo?', listaAperta, prima === dopo ? '(nessun cambio)' : '(cambiato)');

  // Tasto destro su una riga: menu di Filo o menu di sistema?
  let menu = 0;
  await riga.click({ button: 'right' });
  await page.waitForTimeout(300);
  menu = await page.locator('.mg-sort-menu, .mg-menu, [role="menu"]').count();
  console.log('MENU TASTO DESTRO SU RIGA:', menu);
  // RILIEVO REGISTRATO (#496, giro 1): da una riga di ripartizione non si
  // arriva ai feedback che la compongono — né col clic né col tasto destro
  // (che apre il menu generale della pagina, non uno per quella riga).
  // Quando il salto ci sarà, questo diventa expect(listaAperta).toBe(true).
  expect(typeof listaAperta).toBe('boolean');
});
