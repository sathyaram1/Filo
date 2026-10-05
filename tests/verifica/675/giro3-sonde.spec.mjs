// Giro 3, sonde: tante scelte e letture di fila con risposte che arrivano in
// ordine sparso; alla fine lo schermo deve dire quello che c'è sul server.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, doc = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate((init) => {
    window.__doc = Object.assign({}, init);
    window.__getFail = false;
    window.__setLettoFalse = false;
    window.__ritardi = [];
    const RS = window.SN_ROUTINE_SESSIONI;
    const orig = window.filo.message.bind(window.filo);
    const attesa = () => new Promise((r) => setTimeout(r, window.__ritardi.length ? window.__ritardi.shift() : 0));
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        if (window.__getFail) { await attesa(); return { ok: false, error: 'rete giù' }; }
        const r = Object.assign({ ok: true, letto: true }, RS.leggiDoc(window.__doc));
        await attesa();
        return r;
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const patch = {};
        for (const k of RS.CHIAVI) if (msg[k] != null) patch[k] = msg[k];
        const esito = RS.valida(patch);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__doc, esito.valori);
        const r = window.__setLettoFalse
          ? Object.assign({ ok: true, letto: false }, esito.valori)
          : Object.assign({ ok: true, letto: true }, RS.leggiDoc(window.__doc));
        await attesa();
        return r;
      }
      return orig(msg);
    };
  }, doc);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

const radio = (page, v) => page.evaluate((val) => {
  const el = document.querySelector(`input[name="mgPriorityAccount"][value="${val}"]`);
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

async function schermoUgualeServer(page) {
  const s = await page.evaluate(() => ({
    doc: window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc),
    max: document.getElementById('mgMaxSessions').value,
    pri: (document.querySelector('input[name="mgPriorityAccount"]:checked') || {}).value,
    a: document.getElementById('mgAccountA').checked,
    b: document.getElementById('mgAccountB').checked,
    msgs: ['mgMaxSessionsMsg', 'mgPriorityAccountMsg', 'mgAccountsMsg'].map((i) => document.getElementById(i).textContent),
  }));
  expect(s.max).toBe(String(s.doc.maxSessions));
  expect(s.pri).toBe(s.doc.priorityAccount);
  expect(s.a).toBe(!s.doc.accountAOff);
  expect(s.b).toBe(!s.doc.accountBOff);
  for (const m of s.msgs) {
    expect(m).not.toContain('Non ho potuto leggere');
    expect(m).not.toContain('Salvo');
    expect(m).not.toContain('non l\'ho potuto rileggere');
  }
}

const ORDINI = [
  [500, 0, 300, 100, 0],
  [0, 500, 100, 300, 50],
  [300, 300, 0, 0, 600],
  [50, 400, 600, 0, 200],
  [700, 100, 0, 400, 0],
];

for (const [n, ritardi] of ORDINI.entries()) {
  test(`raffica ${n}: numero, A, B, prioritario e una rilettura, risposte in ordine sparso`, async ({ openTab }) => {
    const page = await apri(openTab, { maxSessions: 3, priorityAccount: 'A' });
    await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
    await page.evaluate((r) => { window.__ritardi = r.slice(); }, ritardi);
    await page.locator('#mgMaxSessions').fill('7');
    await page.locator('#mgMaxSessionsSave').click();
    await cambia(page, 'mgAccountA', false);
    await cambia(page, 'mgAccountB', false);
    await radio(page, 'B');
    await page.evaluate(() => { window.__mgTest.loadSessions(); });
    await page.waitForTimeout(1600);
    await schermoUgualeServer(page);
  });
}

test('lettura fallita all\'apertura, poi scrittura senza rilettura, poi scrittura piena: niente avvisi', async ({ openTab }) => {
  const page = await apri(openTab, { maxSessions: 9, accountBOff: true });
  await page.evaluate(() => { window.__getFail = true; });
  await page.evaluate(() => window.__mgTest.loadSessions());
  await expect(page.locator('#mgAccountsMsg')).toContainText('Non ho potuto leggere');
  await page.evaluate(() => { window.__getFail = false; window.__setLettoFalse = true; });
  await page.locator('#mgMaxSessions').fill('5');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('rileggere');
  await page.evaluate(() => { window.__setLettoFalse = false; });
  await cambia(page, 'mgAccountA', false);
  await page.waitForTimeout(500);
  await schermoUgualeServer(page);
});

test('stesso interruttore acceso e spento in fretta, prima risposta lenta', async ({ openTab }) => {
  const page = await apri(openTab, {});
  await page.evaluate(() => { window.__ritardi = [600, 0, 0]; });
  await cambia(page, 'mgAccountA', false);
  await cambia(page, 'mgAccountA', true);
  await cambia(page, 'mgAccountA', false);
  await page.waitForTimeout(1200);
  await schermoUgualeServer(page);
  expect(await page.evaluate(() => window.__doc.accountAOff)).toBe(true);
});
