// Verifica #1919, giro 1: in Gestione ogni nota della conversazione porta il segno della sua fiducia.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';

test('ogni nota dice se è fidata: owner e impronta fidate, impronta mancante non fidata, nei due temi', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest && !!window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady && window.__mgTest.whenReady());
  await page.evaluate(async () => {
    const T = window.SN_FEEDBACK_THREAD;
    let notes = 'Primo report di una routine pulita 🧵 con <b>markup</b>.';
    notes = T.appendModelTurn(notes, 'Verdetto di un verificatore sporco.', { ts: '01/11/26, 10:00' });
    notes = T.appendUserTurn(notes, 'Risposta mia.', { ts: '01/11/26, 11:00' });
    notes = T.appendModelTurn(notes, 'Controllo di sicurezza pulito.', { ts: '01/11/26, 12:00' });
    const turni = T.splitNotes(notes);
    const fid = [await T.improntaTurno(turni[0].grezzo), await T.improntaTurno(turni[3].grezzo)];
    const fb = {
      _id: 'v1919', seq: 1919, subSeq: 0, name: 'Note fidate', text: 'Testo.', clientId: 'owner:me', senderProof: 'admin',
      fiducia: 'fidato', status: 'todo', statusPublic: 'open', createdAt: '2026-10-30T10:00:00Z', images: [],
      notes, noteFidate: fid,
    };
    window.__mgTest.setAdmin && window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  });
  const bolle = page.locator('#mgDetail .mg-bubble');
  await expect(page.locator('#mgDetail .mg-bubble-who .mg-fiducia-segno')).toHaveCount(4);
  const segni = await page.locator('#mgDetail .mg-bubble').evaluateAll((els) => els.map((b) => {
    const s = b.querySelector('.mg-bubble-who .mg-fiducia-segno');
    return { testo: b.innerText.slice(0, 60), segno: s ? s.getAttribute('aria-label') : null };
  }));
  const conSegno = segni.filter((s) => s.segno);
  expect(conSegno.map((s) => s.segno)).toEqual(['Nota fidata', 'Nota non fidata', 'Nota fidata', 'Nota fidata']);
  mkdirSync('tests/.shots', { recursive: true });
  for (const t of ['light', 'dark']) {
    await page.evaluate((x) => document.documentElement.setAttribute('data-sn-theme', x), t);
    await page.waitForTimeout(200);
    await page.locator('#mgDetail').screenshot({ path: `tests/.shots/v1919-note-${t}.png` });
  }
  expect(await bolle.count()).toBeGreaterThan(4);
});

test('senza il campo (note di prima) ogni nota d’altri è non fidata, quelle dell’owner fidate', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest && !!window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady && window.__mgTest.whenReady());
  await page.evaluate(() => {
    const T = window.SN_FEEDBACK_THREAD;
    let notes = 'Report vecchio.';
    notes = T.appendUserTurn(notes, 'Mia.', { ts: '01/11/26, 11:00' });
    const fb = { _id: 'v1919b', seq: 1920, subSeq: 0, name: 'Vecchie', text: 'Testo.', clientId: 'owner:me', fiducia: 'fidato',
      status: 'todo', statusPublic: 'open', createdAt: '2026-10-30T10:00:00Z', images: [], notes };
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  });
  await expect(page.locator('#mgDetail .mg-bubble-who .mg-fiducia-segno')).toHaveCount(2);
  const s = await page.locator('#mgDetail .mg-bubble-who .mg-fiducia-segno').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(s).toEqual(['Nota non fidata', 'Nota fidata']);
});
