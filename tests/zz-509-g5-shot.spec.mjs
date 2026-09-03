// Sonda visiva #509 giro 5 (temporanea): come si vedono le due pagine con la
// stessa coda mista, a tema chiaro e a tema scuro, e senza la chiave.
import { test } from './fixtures/electron.mjs';
import fs from 'node:fs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const CIFRATO = 'FENCv1:AAAABBBBCCCCDDDD==';
const OUT = 'tests/.shots';

const MISTA = [
  { _id: 'r_unlab',   seq: 1, status: 'unlabeled', name: 'non filtrato vero' },
  { _id: 'r_aligned', seq: 2, status: 'aligned',   name: 'allineato vero' },
  { _id: 'r_attack',  seq: 3, status: 'attack',    name: 'attacco' },
  { _id: 'r_todo',    seq: 4, status: 'todo',      name: 'in coda' },
  { _id: 'r_atkconf', seq: 5, status: 'attack_confirmed', name: 'attacco confermato' },
  { _id: 'k_closed',  seq: 6, status: CIFRATO, statusPublic: 'closed', name: 'cifrata chiusa' },
  { _id: 'k_open',    seq: 7, status: CIFRATO, statusPublic: 'open',   name: 'cifrata aperta' },
].map((f) => Object.assign({
  text: `Testo di ${f._id}.`, createdAt: '2026-08-01T10:00:00Z', clientId: 'tester',
}, f));

async function tema(p, t) {
  await p.evaluate((v) => { document.documentElement.dataset.theme = v; document.body.dataset.theme = v; }, t);
}

test('sonda visiva #509/g5', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });

  const mg = await openTab(MANAGE);
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20_000 });
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((l) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(l);
    window.__mgTest.setReleasedVersion('1.0.0');
  }, MISTA);
  await mg.waitForTimeout(400);
  await mg.screenshot({ path: `${OUT}/509g5-manage-lista.png` });
  // Dettaglio di una cifrata (etichetta di stato, giudici, bolle).
  await mg.evaluate(() => window.__mgTest.openDetail('k_closed'));
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${OUT}/509g5-manage-dettaglio-cifrata.png` });
  // Dettaglio di un attacco confermato (riga di stato + azioni generate).
  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.evaluate(() => window.__mgTest.openDetail('r_atkconf'));
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${OUT}/509g5-manage-dettaglio-confermato.png` });
  await tema(mg, 'dark');
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${OUT}/509g5-manage-scuro.png` });
  // Senza chiave: niente sezioni.
  await mg.evaluate((l) => window.__mgTest.setData(l.map((f) => ({ ...f, status: 'FENCv1:zzz' }))), MISTA);
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${OUT}/509g5-manage-senza-chiave-scuro.png` });
  await tema(mg, 'light');
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${OUT}/509g5-manage-senza-chiave.png` });

  const fb = await openTab(FEEDBACK);
  await fb.waitForFunction(() => window.__fbTest, null, { timeout: 20_000 });
  await fb.evaluate((l) => {
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(l);
    window.__fbTest.setReleasedVersion('1.0.0');
  }, MISTA);
  await fb.waitForTimeout(400);
  await fb.screenshot({ path: `${OUT}/509g5-feedback-lista.png` });
  await tema(fb, 'dark');
  await fb.waitForTimeout(300);
  await fb.screenshot({ path: `${OUT}/509g5-feedback-scuro.png` });
  await fb.evaluate((l) => window.__fbTest.setData(l.map((f) => ({ ...f, status: 'FENCv1:zzz' }))), MISTA);
  await tema(fb, 'light');
  await fb.waitForTimeout(300);
  await fb.screenshot({ path: `${OUT}/509g5-feedback-senza-chiave.png` });
});
