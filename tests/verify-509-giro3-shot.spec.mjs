// #509 — giro 3: tracce visive (screenshot in tests/.shots/, gitignorati).
import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const DIR = 'tests/.shots';

const CODA = [
  { _id: 'x01', seq: 1, status: 'unlabeled',        name: 'non filtrato',   text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'x02', seq: 2, status: 'attack',           name: 'attacco',        text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'x05', seq: 5, status: 'todo',             name: 'in coda',        text: 'e', createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'x09', seq: 9, status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso uscito', text: 'i', createdAt: '2026-08-09T10:00:00Z' },
  { _id: 'x11', seq: 11, status: 'attack_confirmed', name: 'attacco confermato', text: 'k', createdAt: '2026-08-11T10:00:00Z' },
];
const CIFRATA = [
  { _id: 'e1', seq: 1, status: 'FENC1:aaaaaaaaaaaa', statusPublic: 'open',   name: 'aperta', text: '1', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'e2', seq: 2, status: 'FENC1:bbbbbbbbbbbb', statusPublic: 'closed', name: 'chiusa', text: '2', createdAt: '2026-08-02T10:00:00Z' },
];

async function prep(page, hook, items) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction((h) => window[h] && window.SN_MANAGE_REVIEW, hook);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.com' } };
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  });
  if (hook === '__fbTest') {
    await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'o@e.com' }));
    await page.evaluate(() => window.__fbTest.setReleasedVersion('1.0.0'));
    await page.evaluate((i) => window.__fbTest.setData(i), items);
  } else {
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.setReleasedVersion('1.0.0'));
    await page.evaluate((i) => window.__mgTest.setData(i), items);
  }
  await page.waitForTimeout(300);
}

test('#509/3 — tracce visive delle due pagine', async ({ openTab }) => {
  mkdirSync(DIR, { recursive: true });

  const fb = await openTab(FEEDBACK); await prep(fb, '__fbTest', CODA);
  await fb.screenshot({ path: `${DIR}/509g3-feedback-sezioni.png`, fullPage: true });

  const mg = await openTab(MANAGE); await prep(mg, '__mgTest', CODA);
  await mg.screenshot({ path: `${DIR}/509g3-gestione-sezioni.png`, fullPage: true });

  // Il difetto: attacco confermato negli Archiviati, pannello di gestione.
  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  await mg.waitForTimeout(200);
  await mg.evaluate(() => window.__mgTest.openDetail('x11'));
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${DIR}/509g3-gestione-archiviati-confermato.png`, fullPage: true });

  await fb.evaluate(() => window.__fbTest.setTab('archived'));
  await fb.waitForTimeout(300);
  await fb.screenshot({ path: `${DIR}/509g3-feedback-archiviati.png`, fullPage: true });

  // Stati illeggibili, sulle due pagine.
  await fb.evaluate((i) => window.__fbTest.setData(i), CIFRATA);
  await fb.waitForTimeout(300);
  await fb.screenshot({ path: `${DIR}/509g3-feedback-illeggibile.png`, fullPage: true });
  await mg.evaluate((i) => window.__mgTest.setData(i), CIFRATA);
  await mg.waitForTimeout(300);
  await mg.screenshot({ path: `${DIR}/509g3-gestione-illeggibile.png`, fullPage: true });
});
