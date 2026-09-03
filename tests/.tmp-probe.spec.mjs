import { test } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

const MISTA = [
  { _id: 'r_todo',   seq: 1, status: 'todo',     name: 'in coda leggibile' },
  { _id: 'k_open',   seq: 3, status: 'FENC1:aaaaaaaa', statusPublic: 'open',   name: 'cifrata aperta' },
  { _id: 'k_closed', seq: 4, status: 'FENC1:bbbbbbbb', statusPublic: 'closed', name: 'cifrata chiusa' },
].map((f, i) => Object.assign({ text: 'testo', createdAt: `2026-08-0${i + 1}T10:00:00Z` }, f));

const TUTTA = MISTA.filter((f) => f._id.startsWith('k_'));

async function apri(openTab) {
  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20000 });
  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20000 });
  await mg.evaluate(() => window.__mgTest.whenReady());
  return { fb, mg };
}

async function dump(fb, mg, coda, titolo) {
  await fb.evaluate((l) => { window.__fbTest.setAdmin(true, { email: 'o@e.com' }); window.__fbTest.setData(l); window.__fbTest.setReleasedVersion('1.0.0'); }, coda);
  await mg.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('1.0.0'); }, coda);
  console.log(`\n\n########## ${titolo} ##########`);
  for (const id of ['k_open', 'k_closed']) {
    const cardFb = await fb.evaluate((i) => { const c = document.querySelector(`.fb-card[data-id="${i}"]`); return c ? c.innerText.replace(/\n+/g, ' | ') : '(assente)'; }, id);
    const cardMg = await mg.evaluate((i) => { const c = document.querySelector(`#mgList .mg-item[data-id="${i}"]`); return c ? c.innerText.replace(/\n+/g, ' | ') : '(assente)'; }, id);
    console.log(`\n-- ${id} --`);
    console.log(`SCHEDA feedback : ${cardFb}`);
    console.log(`SCHEDA gestione : ${cardMg}`);
    await mg.evaluate((i) => window.__mgTest.openDetail(i), id);
    const giud = await mg.evaluate(() => { const e = document.getElementById('mgJudgesRow'); return e && !e.hidden ? e.innerText.trim() : '(riga giudici nascosta)'; });
    const th = await mg.evaluate(() => document.getElementById('mgThread').innerText.replace(/\n+/g, ' | '));
    console.log(`DETTAGLIO gestione — riga giudici: "${giud}"`);
    console.log(`DETTAGLIO gestione — conversazione: ${th}`);
  }
}

test('parità cifrati', async ({ openTab }) => {
  const { fb, mg } = await apri(openTab);
  await dump(fb, mg, MISTA, 'CODA MISTA (sezioni disegnate)');
  await dump(fb, mg, TUTTA, 'CODA TUTTA CIFRATA (sezioni tolte)');
});
