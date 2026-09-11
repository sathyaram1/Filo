// Verifica #496 — giro 15. Le strade con cui si usa la scheda.
//
// Ogni numero della scheda promette di aprirsi su cosa ha contato (è la regola
// che questo stesso lavoro ha scritto). Qui si prova ogni superficie: clic,
// Invio, tasto destro. Più il tema scuro, la finestra scritta a mano coi casi
// limite, e i testi che arrivano da fuori (HTML, emoji, 10.000 caratteri).

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (t) => `--- Aggiornamento dell'agente del ${t} ---`;
const FIX = 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.';

function verbale(esito, livelli) {
  const n = livelli.length;
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto.',
    esito,
    ...livelli.map((l, i) => `- [${l}] rilievo ${i + 1}`),
  ].join('\n');
}

function conversazione(giri) {
  const t = [];
  for (let k = 0; k < giri; k += 1) {
    t.push(`${AG(`0${k + 1}/09/2026, 10:00`)}\n${verbale(FIX, [1, 0])}`);
  }
  t.push(`${AG('08/09/2026, 10:00')}\nVerifica superata.`);
  return t.join('\n\n');
}

const NOMI = {
  html: '<img src=x onerror="window.__xss=1">ciao',
  emoji: '👨‍👩‍👧‍👦 prova 🎉',
  lungo: 'L'.repeat(10000),
};

const INSIEME = [
  { _id: 'a', seq: 901, subSeq: 0, clientId: 'tester@example.com', name: NOMI.html, text: NOMI.html, status: 'done', createdAt: iso(9), _updateTime: iso(1), resolvedInVersion: '1.0.0', notes: conversazione(0) },
  { _id: 'b', seq: 902, subSeq: 0, clientId: 'routine:prober', name: NOMI.emoji, text: NOMI.emoji, status: 'done', createdAt: iso(8), _updateTime: iso(1), resolvedInVersion: '1.0.0', notes: conversazione(1) },
  { _id: 'c', seq: 903, subSeq: 0, clientId: 'routine:verifier', name: NOMI.lungo, text: NOMI.lungo, status: 'done', createdAt: iso(7), _updateTime: iso(2), resolvedInVersion: '1.0.0', notes: conversazione(2) },
  { _id: 'd', seq: 904, subSeq: 0, clientId: 'owner:x', name: 'in coda', text: 'in coda', status: 'todo', createdAt: iso(3) },
  { _id: 'e', seq: 905, subSeq: 0, clientId: 'local:s', name: 'in lavorazione', text: 'in lavorazione', status: 'working', createdAt: iso(2) },
];

async function apri(page, dati = INSIEME) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((l) => window.__mgTest.setData(l), dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);
}

test('ogni superficie che porta un numero si apre, col clic e col tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  for (const id of ['lavorati', 'routine', 'adesso']) {
    const b = page.locator(`[data-card-toggle="${id}"]`);
    if (await b.count()) await b.click();
  }
  await page.waitForTimeout(150);

  const superfici = await page.evaluate(() => Array.from(
    document.querySelectorAll('#panel-fbstats [data-drill], #panel-fbstats [data-drill-menu], #panel-fbstats [data-group], #panel-fbstats [data-copia], #panel-fbstats [data-bucket], #panel-fbstats [data-window]'))
    .map((el, i) => {
      el.dataset.sonda = String(i);
      return {
        i,
        tag: el.tagName,
        testo: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
        drill: el.dataset.drill || el.dataset.drillMenu || (el.dataset.group ? `giri:${el.dataset.group}` : ''),
        copia: el.dataset.copia === '1',
        bucket: el.dataset.bucket || '',
        finestra: el.dataset.window || '',
        cursore: getComputedStyle(el).cursor,
        focusabile: el.tabIndex >= 0,
      };
    }));
  console.log('SUPERFICI ' + JSON.stringify(superfici, null, 1));

  // Tasto destro su ognuna: che voci escono?
  const esiti = [];
  for (const s of superfici) {
    const el = page.locator(`#panel-fbstats [data-sonda="${s.i}"]`);
    if (!(await el.count())) { esiti.push({ i: s.i, testo: s.testo, voci: '(sparita)' }); continue; }
    try {
      await el.first().click({ button: 'right', force: true });
    } catch (e) {
      esiti.push({ i: s.i, testo: s.testo, voci: '(non cliccabile: ' + e.message.slice(0, 40) + ')' });
      continue;
    }
    await page.waitForTimeout(60);
    const voci = await page.evaluate(() => {
      const m = document.querySelector('.mg-ctxmenu');
      return m ? Array.from(m.querySelectorAll('.sn-select-option')).map((o) => o.textContent.trim()) : null;
    });
    esiti.push({ i: s.i, testo: s.testo, voci });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(30);
  }
  console.log('TASTO DESTRO ' + JSON.stringify(esiti, null, 1));
});

test('il clic apre l’elenco, e l’elenco dice chi ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  for (const id of ['lavorati', 'adesso']) {
    const b = page.locator(`[data-card-toggle="${id}"]`);
    if (await b.count()) await b.click();
  }
  await page.waitForTimeout(150);
  const chiavi = await page.evaluate(() => Array.from(
    document.querySelectorAll('#panel-fbstats [data-drill]')).map((el) => el.dataset.drill));
  console.log('CHIAVI ' + JSON.stringify(chiavi));
  for (const k of chiavi) {
    const sel = `#panel-fbstats [data-drill="${k.replace(/"/g, '\\"')}"]`;
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    await el.click();
    await page.waitForTimeout(120);
    const voci = await page.evaluate(() => {
      const d = document.querySelector('#panel-fbstats .mg-st-drill');
      return d ? Array.from(d.querySelectorAll('button, li')).map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)) : null;
    });
    console.log(`DRILL ${k} → ${JSON.stringify(voci)}`);
    await el.click();
    await page.waitForTimeout(60);
  }
  console.log('XSS? ' + await page.evaluate(() => !!window.__xss));
});

test('la fetta e la voce di legenda si comportano allo stesso modo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const fetta = page.locator('#mgStPie [data-group]').first();
  await fetta.click();
  await page.waitForTimeout(120);
  const dopoFetta = await page.evaluate(() => {
    const d = document.querySelector('#panel-fbstats .mg-st-drill');
    return d ? d.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  });
  await fetta.click();
  await page.waitForTimeout(80);
  const legenda = page.locator('#mgStPieLegend [data-drill]').first();
  await legenda.click();
  await page.waitForTimeout(120);
  const dopoLegenda = await page.evaluate(() => {
    const d = document.querySelector('#panel-fbstats .mg-st-drill');
    return d ? d.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  });
  console.log('FETTA   → ' + dopoFetta);
  console.log('LEGENDA → ' + dopoLegenda);
});

test('finestra scritta a mano: casi limite', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.locator('[data-window="custom"]').click();
  await page.waitForTimeout(120);
  const casi = [
    ['', ''],
    ['2026-09-05', ''],
    ['', '2026-09-05'],
    ['2026-09-09', '2026-09-01'],
    ['1900-01-01', '2026-09-11'],
    ['0001-01-01', '9999-12-31'],
    ['2026-09-05', '2026-09-05'],
  ];
  for (const [da, a] of casi) {
    await page.evaluate(([d, x]) => {
      const f = document.getElementById('mgStFrom');
      const t = document.getElementById('mgStTo');
      f.value = d; t.value = x;
      f.dispatchEvent(new Event('change', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }, [da, a]);
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => ({
      eco: (document.getElementById('mgStCustomEco') || {}).textContent || '',
      avviso: (document.getElementById('mgStNote') || {}).textContent.replace(/\s+/g, ' ').trim(),
      ricevuti: (document.querySelector('[data-card="ricevuti"] .mg-st-card-value') || {}).textContent,
      barre: (document.getElementById('mgStBarsNote') || {}).textContent.replace(/\s+/g, ' ').trim(),
      colonne: document.querySelectorAll('#mgStBars [data-bucket]').length,
    }));
    console.log(`CUSTOM ${da || '(vuoto)'} → ${a || '(vuoto)'} : ${JSON.stringify(r)}`);
  }
});

test('clic rapidi e filtri a raffica non lasciano la scheda incoerente', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  for (let k = 0; k < 6; k += 1) {
    await page.locator('[data-window="24h"]').click();
    await page.locator('[data-window="all"]').click();
    await page.locator('#mgStCreators [data-creator-group="routine"]').click();
    await page.locator('#mgStCreators [data-creator-all]').click();
  }
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    ricevuti: (document.querySelector('[data-card="ricevuti"] .mg-st-card-value') || {}).textContent,
    accese: Array.from(document.querySelectorAll('#mgStWindows .mg-st-chip--on, #mgStCreators .mg-st-chip--on')).map((e) => e.textContent.trim()),
    torta: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log('RAFFICA ' + JSON.stringify(r));
  expect(r.ricevuti).toBe('5');
});

test('traccia visiva sul tema scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  for (const id of ['lavorati', 'routine', 'adesso']) {
    const b = page.locator(`[data-card-toggle="${id}"]`);
    if (await b.count()) await b.click();
  }
  await page.locator('[data-window="custom"]').click();
  await page.waitForTimeout(300);
  console.log('TEMA ' + await page.evaluate(() => document.documentElement.getAttribute('data-sn-theme')));
  await page.screenshot({ path: 'tests/.shots/496-giro15-scuro2.png', fullPage: true });
  // il drill aperto sul tema scuro
  await page.locator('#mgStPieLegend [data-drill]').first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/496-giro15-scuro-drill.png', fullPage: true });
});
