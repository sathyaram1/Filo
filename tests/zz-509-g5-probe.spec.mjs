// Sonda #509 giro 5 (temporanea): porte residue da provare.
import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const CIFRATO = 'FENCv1:AAAA==';
const V = '1.0.0';

const CODA = [
  { _id: 'a_unlab', seq: 1, status: 'unlabeled', name: 'non filtrato' },
  { _id: 'a_todo',  seq: 2, status: 'todo',      name: 'in coda' },
  { _id: 'a_done',  seq: 3, status: 'done', resolvedInVersion: '0.9.0', name: 'uscito',
    notes: 'Report della lavorazione, in chiaro.' },
  { _id: 'a_arch',  seq: 4, status: 'archived',  name: 'archiviato' },
  // statusPublic ostile
  { _id: 'a_xss',   seq: 5, status: CIFRATO, statusPublic: '<img src=x onerror=alert(1)>', name: 'enum ostile' },
].map((f) => Object.assign({ text: 'testo', createdAt: '2026-08-01T10:00:00Z', clientId: 'tester' }, f));

async function apriManage(openTab, coda) {
  const p = await openTab(MANAGE);
  await p.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20_000 });
  await p.evaluate(() => window.__mgTest.whenReady());
  await p.evaluate(({ list, v }) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(list);
    window.__mgTest.setReleasedVersion(v);
  }, { list: coda, v: V });
  return p;
}
async function apriFeedback(openTab, coda) {
  const p = await openTab(FEEDBACK);
  await p.waitForFunction(() => window.__fbTest, null, { timeout: 20_000 });
  await p.evaluate(({ list, v }) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(list);
    window.__fbTest.setReleasedVersion(v);
  }, { list: coda, v: V });
  return p;
}

test('sonda A — il pannello aperto dopo una ricarica della lista', async ({ openTab }) => {
  const mg = await apriManage(openTab, CODA);
  await mg.evaluate(() => window.__mgTest.setTab('queue'));
  await mg.evaluate(() => window.__mgTest.openDetail('a_todo'));
  const prima = await mg.evaluate(() => ({
    stato: document.getElementById('mgDetailState').textContent.trim(),
    azioni: Array.from(document.querySelectorAll('#mgActionsRow button')).map((b) => b.textContent.trim()),
  }));
  // La lista si ricarica (è ciò che fa loadData dopo "Ri-valuta i non filtrati"):
  // la stessa segnalazione ora è archiviata.
  await mg.evaluate((l) => window.__mgTest.setData(l), CODA.map((f) =>
    (f._id === 'a_todo' ? { ...f, status: 'archived' } : f)));
  const dopo = await mg.evaluate(() => ({
    stato: document.getElementById('mgDetailState').textContent.trim(),
    azioni: Array.from(document.querySelectorAll('#mgActionsRow button')).map((b) => b.textContent.trim()),
  }));
  console.log('SONDA-A prima=', JSON.stringify(prima), ' dopo=', JSON.stringify(dopo));
  // Comunque premere non deve scrivere uno stato non più offerto.
  await mg.evaluate(() => { window.__updates = []; });
  await mg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#mgActionsRow button'))
      .find((x) => x.textContent.includes('Risolto'));
    if (b) b.click();
  });
  await mg.waitForTimeout(400);
  const u = await mg.evaluate(() => window.__updates);
  console.log('SONDA-A scritture=', JSON.stringify(u));
  expect(u, 'nessuna scrittura di uno stato non più offerto').toEqual([]);
});

test('sonda B — riapertura con testo: stessa scrittura sulle due pagine', async ({ openTab }) => {
  const mg = await apriManage(openTab, CODA);
  const fb = await apriFeedback(openTab, CODA);

  await fb.evaluate(() => window.__fbTest.setTab('resolved'));
  await fb.evaluate(() => {
    const card = document.querySelector('.fb-card[data-id="a_done"]');
    const b = Array.from(card.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Riapri');
    b.click();
  });
  await fb.waitForTimeout(200);
  await fb.evaluate(() => {
    const card = document.querySelector('.fb-card[data-id="a_done"]');
    const ta = card.querySelector('textarea');
    ta.value = 'manca ancora il caso X';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const b = Array.from(card.querySelectorAll('button')).find((x) => x.textContent.includes('Conferma'));
    b.click();
  });
  await fb.waitForTimeout(500);
  const wf = await fb.evaluate(() => window.__updates);

  await mg.evaluate(() => window.__mgTest.setTab('resolved'));
  await mg.evaluate(() => window.__mgTest.openDetail('a_done'));
  await mg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#mgActionsRow button'))
      .find((x) => x.textContent.trim() === 'Riapri');
    b.click();
  });
  await mg.waitForTimeout(200);
  await mg.evaluate(() => {
    document.getElementById('mgReopenText').value = 'manca ancora il caso X';
    document.getElementById('mgReopenConfirmBtn').click();
  });
  await mg.waitForTimeout(500);
  const wm = await mg.evaluate(() => window.__updates);

  console.log('SONDA-B feedback=', JSON.stringify(wf));
  console.log('SONDA-B gestione=', JSON.stringify(wm));
  expect(wf.length, 'una scrittura sulla pagina dei feedback').toBe(1);
  expect(wm.length, 'una scrittura su Gestione').toBe(1);
  expect(wm[0].status).toBe(wf[0].status);
  // Il report esistente resta, e il turno dell'utente si aggiunge.
  expect(String(wm[0].notes || ''), 'Gestione conserva il report').toContain('Report della lavorazione');
  expect(String(wf[0].notes || ''), 'la gemella conserva il report').toContain('Report della lavorazione');
  expect(String(wm[0].notes || '')).toContain('manca ancora il caso X');
  expect(String(wf[0].notes || '')).toContain('manca ancora il caso X');
});

test('sonda C — enum pubblico ostile: niente esecuzione, niente etichetta inventata', async ({ openTab }) => {
  const mg = await apriManage(openTab, CODA);
  const fb = await apriFeedback(openTab, CODA);
  let bang = false;
  mg.on('dialog', async (d) => { bang = true; await d.dismiss(); });
  fb.on('dialog', async (d) => { bang = true; await d.dismiss(); });
  await mg.evaluate(() => window.__mgTest.setTab('inbox'));
  const html = await mg.evaluate(() => {
    const it = document.querySelector('#mgList .mg-item[data-id="a_xss"]');
    return it ? it.innerHTML : '';
  });
  console.log('SONDA-C html=', html.slice(0, 400));
  expect(html).not.toContain('onerror=');
  expect(bang).toBe(false);
});

test('sonda D — ricerca con le sezioni spente, e ritorno', async ({ openTab }) => {
  const tutte = CODA.map((f) => ({ ...f, status: CIFRATO }));
  const mg = await apriManage(openTab, tutte);
  const barra = () => mg.evaluate(() => Array.from(document.querySelectorAll('#mgTabs .mg-tab'))
    .filter((el) => !el.hidden && ['inbox', 'queue', 'resolved', 'archived'].includes(el.dataset.tab)).length);
  expect(await barra()).toBe(0);
  // Apri la lente e cerca (fallback per testo: nessun modello negli spec).
  await mg.evaluate(() => window.__mgTest.runSearch && null);
  await mg.evaluate(() => { document.getElementById('mgSearchBtn').click(); });
  await mg.waitForTimeout(200);
  await mg.evaluate(() => window.__mgTest.runSearch('coda'));
  await mg.waitForTimeout(1500);
  const testa = await mg.evaluate(() => document.getElementById('mgListHead').textContent.trim());
  console.log('SONDA-D testa ricerca=', testa);
  // Esci dalla ricerca: le sezioni restano spente, non tornano coi numeri.
  await mg.keyboard.press('Escape');
  await mg.waitForTimeout(400);
  await mg.evaluate(() => { const b = document.getElementById('mgSearchBtn'); if (b) b.click(); });
  await mg.waitForTimeout(400);
  const n = await barra();
  const testa2 = await mg.evaluate(() => document.getElementById('mgListHead').textContent.trim());
  const avviso = await mg.evaluate(() => { const e = document.getElementById('mgNoSections'); return e.hidden ? '' : e.textContent.trim(); });
  console.log('SONDA-D dopo uscita: sezioni=', n, ' testa=', testa2, ' avviso=', avviso ? 'presente' : 'ASSENTE');
  expect(n, 'le sezioni non tornano quando lo stato resta illeggibile').toBe(0);
});
