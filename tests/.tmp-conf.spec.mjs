import { test } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

// Coda MISTA: due leggibili, una illeggibile ma CHIUSA.
const MISTA = [
  { _id: 'r_todo',   seq: 1, status: 'todo',     name: 'in coda leggibile' },
  { _id: 'r_arch',   seq: 2, status: 'archived', name: 'archiviato leggibile' },
  { _id: 'k_closed', seq: 3, status: 'FENC1:bbbbbbbb', statusPublic: 'closed', name: 'cifrata chiusa' },
].map((f, i) => Object.assign({ text: 'testo', createdAt: `2026-08-0${i + 1}T10:00:00Z` }, f));

test('conferma porte coda mista', async ({ openTab }) => {
  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20000 });
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('1.0.0'); }, MISTA);
  await mg.evaluate(() => window.__mgTest.setTab('inbox'));

  const barra = await mg.evaluate(() => {
    const b = document.getElementById('mgReevalBar');
    const btn = document.getElementById('mgReevalBtn');
    return { nascosta: b ? b.hidden : null, testo: btn ? btn.textContent.trim() : null };
  });
  console.log('\nBARRA "Ri-valuta i non filtrati":', JSON.stringify(barra));

  const card = await mg.evaluate(() => {
    const c = document.querySelector('#mgList .mg-item[data-id="k_closed"]');
    if (!c) return '(assente dai Ricevuti)';
    return { classi: c.className, bordo: c.style.borderLeftColor, testo: c.innerText.replace(/\n+/g, ' | '), hover: c.title };
  });
  console.log('SCHEDA gestione della cifrata chiusa:', JSON.stringify(card));

  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20000 });
  await fb.evaluate((l) => { window.__fbTest.setAdmin(true, { email: 'o@e.com' }); window.__fbTest.setData(l); window.__fbTest.setReleasedVersion('1.0.0'); }, MISTA);
  await fb.evaluate(() => window.__fbTest.setTab('inbox'));
  const cardFb = await fb.evaluate(() => {
    const c = document.querySelector('.fb-card[data-id="k_closed"]');
    return c ? c.innerText.replace(/\n+/g, ' | ') : '(assente)';
  });
  console.log('SCHEDA feedback della stessa segnalazione:', JSON.stringify(cardFb));
});
