// #1918: il sì come lavoro locale dalla pagina dei feedback chiede anche la fiducia al server, e vale la sua risposta.
// Un feedback con una radice che nessun timbro toglie resta non fidato: la pagina lo dice, non lo segna fidato.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';
const RICEVUTI = [
  { _id: 'r1', seq: 1916, status: 'unlabeled', name: 'Segnalazione di un utente', text: 'Il testo di un utente.',
    clientId: 'tester-uno', createdAt: '2026-10-30T10:00:00Z', fiducia: 'non_fidato' },
];

async function apri(openTab, rispostaFiducia) {
  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate(({ list, risposta }) => {
    window.__fiducia = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      if (msg && msg.type === 'fiducia_segna') { window.__fiducia.push(msg); return risposta; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(list);
    window.__fbTest.setTab('inbox');
  }, { list: RICEVUTI, risposta: rispostaFiducia });
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
  const avvisi = [];
  page.on('dialog', async (d) => { avvisi.push(d.message()); await d.dismiss().catch(() => {}); });
  return { page, avvisi };
}

test('il server lo lascia non fidato: la pagina lo dice, e la fusione chiederà il via libera', async ({ openTab }) => {
  const { page, avvisi } = await apri(openTab, { ok: true, fiducia: 'non_fidato' });
  await page.locator('.fb-act[data-id="r1"][data-local]').first().click();
  await expect.poll(() => page.evaluate(() => window.__fiducia.length)).toBe(1);
  await expect.poll(() => avvisi.length).toBe(1);
  expect(avvisi[0]).toMatch(/resta non fidato/);
  expect(avvisi[0]).toMatch(/via libera/);
});

test('il server lo fa fidato: nessun avviso', async ({ openTab }) => {
  const { page, avvisi } = await apri(openTab, { ok: true, fiducia: 'fidato' });
  await page.locator('.fb-act[data-id="r1"][data-local]').first().click();
  await expect.poll(() => page.evaluate(() => window.__fiducia.length)).toBe(1);
  await page.waitForTimeout(300);
  expect(avvisi).toEqual([]);
});
