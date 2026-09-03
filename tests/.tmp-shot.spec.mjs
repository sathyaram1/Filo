import { test } from './fixtures/electron.mjs';
import fs from 'node:fs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const OUT = 'tests/.shots';

const CODA = [
  { _id: 'c_unlabeled', seq: 1,  status: 'unlabeled',           name: 'Non filtrato' },
  { _id: 'c_suspfile',  seq: 2,  status: 'suspicious_file',     name: 'File sospetto allegato al report' },
  { _id: 'c_attack',    seq: 3,  status: 'attack',              name: 'Tentativo di iniezione nel prompt' },
  { _id: 'c_aligned',   seq: 9,  status: 'aligned',             name: 'Allineato, pronto per la coda' },
  { _id: 'c_todo',      seq: 10, status: 'todo',                name: 'In coda di lavorazione' },
  { _id: 'c_done_si',   seq: 15, status: 'done', resolvedInVersion: '0.9.0', name: 'Chiuso e uscito in produzione' },
  { _id: 'c_atkconf',   seq: 17, status: 'attack_confirmed',    name: 'Attacco confermato dall owner' },
].map((f, i) => Object.assign({ text: 'Testo della segnalazione, abbastanza lungo da riempire la scheda e mostrare come si comporta il ritorno a capo.', createdAt: `2026-08-0${i + 1}T10:00:00Z`, clientId: 'tester' }, f));

const CIFRATA = [
  { _id: 'k_open',   seq: 41, status: 'FENC1:aaaaaaaa', statusPublic: 'open',   name: 'Segnalazione aperta', text: 'testo', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'k_closed', seq: 42, status: 'FENC1:bbbbbbbb', statusPublic: 'closed', name: 'Segnalazione chiusa', text: 'testo', createdAt: '2026-08-02T10:00:00Z' },
];

test('scatti', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20000 });
  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20000 });
  await mg.evaluate(() => window.__mgTest.whenReady());

  for (const tema of ['light', 'dark']) {
    await fb.emulateMedia({ colorScheme: tema });
    await mg.emulateMedia({ colorScheme: tema });
    for (const [nome, coda] of [['normale', CODA], ['cifrata', CIFRATA]]) {
      await fb.evaluate((l) => { window.__fbTest.setAdmin(true, { email: 'o@e.com' }); window.__fbTest.setData(l); window.__fbTest.setReleasedVersion('1.0.0'); }, coda);
      await mg.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('1.0.0'); }, coda);
      await fb.waitForTimeout(300);
      await fb.screenshot({ path: `${OUT}/509g4-feedback-${nome}-${tema}.png`, fullPage: false });
      await mg.evaluate((i) => window.__mgTest.openDetail(i), coda[coda.length - 1]._id);
      await mg.waitForTimeout(300);
      await mg.screenshot({ path: `${OUT}/509g4-manage-${nome}-${tema}.png`, fullPage: false });
    }
  }
});
