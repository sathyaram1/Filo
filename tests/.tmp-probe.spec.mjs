import { test } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

const CODA = [
  { _id: 'c_unlabeled', seq: 1,  status: 'unlabeled',           name: 'non filtrato' },
  { _id: 'c_suspfile',  seq: 2,  status: 'suspicious_file',     name: 'file sospetto' },
  { _id: 'c_attack',    seq: 3,  status: 'attack',              name: 'attacco' },
  { _id: 'c_spam',      seq: 4,  status: 'spam',                name: 'spam' },
  { _id: 'c_design',    seq: 5,  status: 'design',              name: 'design' },
  { _id: 'c_aligned',   seq: 9,  status: 'aligned',             name: 'allineato' },
  { _id: 'c_todo',      seq: 10, status: 'todo',                name: 'in coda' },
  { _id: 'c_working',   seq: 11, status: 'working',             name: 'in lavorazione' },
  { _id: 'c_done_si',   seq: 15, status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso e uscito' },
  { _id: 'c_archived',  seq: 16, status: 'archived',            name: 'archiviato' },
  { _id: 'c_atkconf',   seq: 17, status: 'attack_confirmed',    name: 'attacco confermato' },
].map((f, i) => Object.assign({ text: 'testo', createdAt: `2026-08-0${(i % 9) + 1}T10:00:00Z`, clientId: 't' }, f));

test('ordine + riapertura + intestazione', async ({ openTab }) => {
  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20000 });
  await fb.evaluate((l) => {
    window.__updates = [];
    const o = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => { if (m && m.type === 'feedback_update') { window.__updates.push(m); return { ok: true }; } return o(m); };
    window.__fbTest.setAdmin(true, { email: 'o@e.com' }); window.__fbTest.setData(l); window.__fbTest.setReleasedVersion('1.0.0');
  }, CODA);

  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20000 });
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((l) => {
    window.__updates = [];
    const o = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => { if (m && m.type === 'feedback_update') { window.__updates.push(m); return { ok: true }; } return o(m); };
    window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('1.0.0');
  }, CODA);

  for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
    await fb.evaluate((x) => window.__fbTest.setTab(x), t);
    const a = await fb.evaluate(() => Array.from(document.querySelectorAll('.fb-card')).map((c) => c.dataset.id));
    await mg.evaluate((x) => window.__mgTest.setTab(x), t);
    const b = await mg.evaluate(() => Array.from(document.querySelectorAll('#mgList .mg-item')).map((c) => c.dataset.id));
    const head = await mg.evaluate(() => document.getElementById('mgListHead').innerText.trim());
    const conta = await fb.evaluate(() => document.getElementById('count').innerText.trim());
    console.log(`\n[${t}] feedback: ${JSON.stringify(a)}\n[${t}] gestione : ${JSON.stringify(b)}\n[${t}] intestazione gestione: "${head}" | riga feedback: "${conta}"`);
  }

  // Riapertura: flusso su entrambe.
  await fb.evaluate((x) => window.__fbTest.setTab(x), 'resolved');
  const btnFb = await fb.evaluate(() => {
    const c = document.querySelector('.fb-card[data-id="c_done_si"]');
    return Array.from(c.querySelectorAll('.fb-actions button')).map((b) => b.textContent.trim());
  });
  console.log('\nAZIONI feedback su un fix uscito:', JSON.stringify(btnFb));
  // Preme Riapri e guarda cosa compare
  await fb.evaluate(() => {
    const c = document.querySelector('.fb-card[data-id="c_done_si"]');
    Array.from(c.querySelectorAll('.fb-actions button')).find((b) => b.textContent.trim() === 'Riapri').click();
  });
  await fb.waitForTimeout(300);
  const modFb = await fb.evaluate(() => document.querySelector('.fb-card[data-id="c_done_si"]').innerText);
  console.log('\nSCHEDA feedback dopo Riapri:\n' + modFb);

  await mg.evaluate(() => window.__mgTest.openDetail('c_done_si'));
  await mg.evaluate(() => {
    Array.from(document.querySelectorAll('#mgActionsRow button')).find((b) => b.textContent.trim() === 'Riapri').click();
  });
  await mg.waitForTimeout(300);
  const modMg = await mg.evaluate(() => { const e = document.getElementById('mgReopen'); return e.hidden ? '(nascosto)' : e.innerText; });
  console.log('\nMODULO gestione dopo Riapri:\n' + modMg);

  // Conferma senza testo su entrambe
  await fb.evaluate(() => {
    const c = document.querySelector('.fb-card[data-id="c_done_si"]');
    const b = Array.from(c.querySelectorAll('button')).find((x) => /Conferma/i.test(x.textContent));
    if (b) b.click();
  });
  await mg.evaluate(() => document.getElementById('mgReopenConfirmBtn').click());
  await fb.waitForTimeout(400); await mg.waitForTimeout(400);
  console.log('\nScritture riapertura SENZA testo — feedback:', JSON.stringify(await fb.evaluate(() => window.__updates)));
  console.log('Scritture riapertura SENZA testo — gestione:', JSON.stringify(await mg.evaluate(() => window.__updates)));
});
