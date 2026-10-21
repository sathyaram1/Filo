// #1556 giro 2, rilievo 1: la nota del cancello la scrive il server, col marcatore nell'ora del server (UTC), e
// l'owner la legge sul suo computer in ora italiana. La nota scritta un quarto d'ora dopo l'audit deve restare il motivo.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const NOTA = 'Il cancello non fonde il ramo del server: la suite di filo-security non è verde. Decidi tu: archiviarlo, o farlo rifare.';

let tzPrima;
test.beforeAll(() => { tzPrima = process.env.TZ; process.env.TZ = 'Europe/Rome'; });
test.afterAll(() => { if (tzPrima === undefined) delete process.env.TZ; else process.env.TZ = tzPrima; });

test('r1 nota del cancello col marcatore del server, letta in Italia: resta il motivo della fermata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Europe/Rome');
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  // Audit alle 15:40 UTC; il cancello ferma alle 15:55 UTC e il server scrive «21/10/26, 15:55» (toLocaleString senza fuso).
  const fb = {
    _id: 'fb-1556', name: 'Lavoro del server fermo', text: 'Sistemare il cancello del server.',
    seq: 1255, subSeq: 0, status: 'design', statusReason: 'l5', statusPublic: 'open',
    clientId: 'owner:test', createdAt: '2026-10-20T08:00:00Z', images: [],
    notes: `Report di chi ha risolto: fatto.\n\n--- Aggiornamento dell'agente del 21/10/26, 15:55 ---\n${NOTA}`,
    livelli: { l4: { esito: 'pass', at: '2026-10-21T15:40:00.000Z' } },
  };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fb]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate((x) => window.__mgTest.openDetail(x), 'fb-1556');
  const quadrato = page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');
  await expect(quadrato).toHaveClass(/mg-forma--attack/);
  await quadrato.click();
  await expect(page.locator('#mgSideBody')).toContainText('Il cancello non fonde il ramo del server');
});
