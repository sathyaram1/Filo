// TEMPORANEO — solo per guardare il pannello di gestione dopo il ridisegno
// delle azioni (#509, giro 4). Da cancellare dopo l'ispezione.
import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const MANAGE = 'filo://manage/manage.html';
const DIR = '/tmp/claude-0/-home-user-Filo/a7d958b3-0507-5957-8c3d-a1cac45233a4/scratchpad/shots';

const CODA = [
  { _id: 's1', seq: 1, status: 'suspicious_file',  name: 'file sospetto',      text: 'Allegato strano.', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 's2', seq: 2, status: 'attack_confirmed', name: 'attacco confermato', text: 'Prompt injection.', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 's3', seq: 3, status: 'todo',             name: 'in coda',            text: 'Una richiesta normale.', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 's4', seq: 4, status: 'done', resolvedInVersion: '0.9.0', name: 'fix uscito', text: 'Sistemato.', createdAt: '2026-08-04T10:00:00Z' },
];

test('shot: pannello azioni', async ({ openTab }) => {
  mkdirSync(DIR, { recursive: true });
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate(() => window.__mgTest.setAdmin(true));
  await mg.evaluate((i) => window.__mgTest.setData(i), CODA);
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), '1.0.0');

  for (const [id, tab] of [['s1', 'inbox'], ['s2', 'archived'], ['s3', 'queue'], ['s4', 'resolved']]) {
    await mg.evaluate((t) => window.__mgTest.setTab(t), tab);
    await mg.evaluate((x) => window.__mgTest.openDetail(x), id);
    await mg.waitForTimeout(300);
    await mg.screenshot({ path: `${DIR}/${id}-${tab}.png` });
  }
  // Modulo di riapertura aperto.
  await mg.evaluate(() => window.__mgTest.setTab('resolved'));
  await mg.evaluate(() => window.__mgTest.openDetail('s4'));
  await mg.waitForTimeout(200);
  await mg.locator('#mgReopenBtn').click();
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${DIR}/s4-riapertura.png` });
});
