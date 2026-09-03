import { test } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

// Coda MISTA: qualcuno leggibile, qualcuno no. Le sezioni si disegnano (non
// tutti illeggibili): dove finiscono i cifrati?
const MISTA = [
  { _id: 'r_todo',   seq: 1, status: 'todo',     name: 'in coda leggibile' },
  { _id: 'r_arch',   seq: 2, status: 'archived', name: 'archiviato leggibile' },
  { _id: 'k_open',   seq: 3, status: 'FENC1:aaaaaaaa', statusPublic: 'open',   name: 'cifrata aperta' },
  { _id: 'k_closed', seq: 4, status: 'FENC1:bbbbbbbb', statusPublic: 'closed', name: 'cifrata chiusa' },
].map((f, i) => Object.assign({ text: 'testo', createdAt: `2026-08-0${i + 1}T10:00:00Z` }, f));

test('mista + riga giudici', async ({ openTab }) => {
  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20000 });
  await fb.evaluate((l) => { window.__fbTest.setAdmin(true, { email: 'o@e.com' }); window.__fbTest.setData(l); window.__fbTest.setReleasedVersion('1.0.0'); }, MISTA);

  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20000 });
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('1.0.0'); }, MISTA);

  console.log('\nBARRA feedback:', JSON.stringify(await fb.evaluate(() => Array.from(document.querySelectorAll('#tabs [data-tab]')).filter((e) => !e.hidden).map((e) => e.innerText.trim()))));
  console.log('BARRA gestione:', JSON.stringify(await mg.evaluate(() => Array.from(document.querySelectorAll('#mgTabs .mg-tab')).filter((e) => ['inbox','queue','resolved','archived'].includes(e.dataset.tab)).map((e) => e.innerText.trim().replace(/\s+/g,' ')))));

  for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
    await fb.evaluate((x) => window.__fbTest.setTab(x), t);
    const a = await fb.evaluate(() => Array.from(document.querySelectorAll('.fb-card')).map((c) => c.dataset.id));
    await mg.evaluate((x) => window.__mgTest.setTab(x), t);
    const b = await mg.evaluate(() => Array.from(document.querySelectorAll('#mgList .mg-item')).map((c) => c.dataset.id));
    console.log(`[${t}] fb=${JSON.stringify(a)} mg=${JSON.stringify(b)}`);
  }

  // Azioni offerte sui cifrati in una lista MISTA (le sezioni ci sono).
  for (const id of ['k_open', 'k_closed']) {
    for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
      await fb.evaluate((x) => window.__fbTest.setTab(x), t);
      const a = await fb.evaluate((i) => { const c = document.querySelector(`.fb-card[data-id="${i}"]`); return c ? Array.from(c.querySelectorAll('.fb-actions button')).map((b) => b.textContent.trim()) : null; }, id);
      if (a) { console.log(`AZIONI fb ${id} (${t}):`, JSON.stringify(a)); break; }
    }
    await mg.evaluate((i) => window.__mgTest.openDetail(i), id);
    const b = await mg.evaluate(() => { const box = document.getElementById('mgActions'); return box.hidden ? [] : Array.from(document.querySelectorAll('#mgActionsRow button')).map((x) => x.textContent.trim()); });
    console.log(`AZIONI mg ${id}:`, JSON.stringify(b));
    const riga = await mg.evaluate(() => { const e = document.getElementById('mgJudges') || document.querySelector('.mg-judges'); return e ? e.innerText.trim() : '(nessuna riga giudici)'; });
    console.log(`RIGA GIUDICI mg ${id}: "${riga}"`);
    const th = await mg.evaluate(() => document.getElementById('mgThread').innerText.trim());
    console.log(`THREAD mg ${id}:\n${th}\n`);
    const card = await fb.evaluate((i) => { const c = document.querySelector(`.fb-card[data-id="${i}"]`); return c ? c.innerText.trim() : '(non in questa sezione)'; }, id);
    console.log(`SCHEDA fb ${id}:\n${card}\n`);
  }
});
