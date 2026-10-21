// Verifica #1556 giro 3, rilievo 2: letta da un fuso a ovest di Greenwich, una nota di un giro passato passa per il motivo della fermata.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const NOTA = 'Il cancello non fonde il ramo del server: la suite di filo-security non è verde. Decidi tu: archiviarlo, o farlo rifare.';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-1556', name: 'Lavoro del server fermo', text: 'Sistemare il cancello del server.',
    seq: 1255, subSeq: 0, status: 'design', statusReason: 'l5', statusPublic: 'open',
    clientId: 'owner:test', createdAt: '2026-10-20T08:00:00Z', images: [],
    notes: `Report di chi ha risolto: fatto.\n\n--- Aggiornamento dell'agente del 21/10/26, 15:43 ---\n${NOTA}`,
    // L'audit è passato poco prima della nota del cancello (ora locale, come la legge il marcatore).
    livelli: { l4: { esito: 'pass', at: new Date(2026, 9, 21, 15, 40).toISOString() } },
  }, over);
}

async function apri(page, lista, { pending = [], updateErr = '' } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return cfg.updateErr ? { ok: false, error: cfg.updateErr } : { ok: true };
      }
      return orig(msg);
    };
  }, { pending, updateErr });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

const quadrato = (page) => page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');

async function apriQuadrato(page, id) {
  await page.evaluate((x) => window.__mgTest.openDetail(x), id);
  await expect(quadrato(page)).toHaveClass(/mg-forma--attack/);
  await quadrato(page).click();
}

test.describe('letta a New York', () => {
  let tzPrima;
  test.beforeAll(() => { tzPrima = process.env.TZ; process.env.TZ = 'America/New_York'; });
  test.afterAll(() => { if (tzPrima === undefined) delete process.env.TZ; else process.env.TZ = tzPrima; });

  test('r2 ferma senza nota del cancello: il report scritto prima dell’audit non passa per il motivo', async ({ openTab }) => {
    const page = await openTab(MANAGE);
    // Il server scrive in ora di Greenwich: il report è delle 14:00, l'audit delle 15:40, il cancello non ha scritto niente.
    const notes = "Segnalazione ripresa.\n\n--- Aggiornamento dell'agente del 21/10/26, 14:00 ---\nReport: tasto spostato a destra, prove verdi.";
    await apri(page, [pratica({ notes, livelli: { l4: { esito: 'pass', at: '2026-10-21T15:40:00.000Z' } } })]);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/New_York');
    await apriQuadrato(page, 'fb-1556');
    await expect(page.locator('#mgSideBody')).toContainText('Nessuna richiesta di fusione è aperta');
    await expect(page.locator('#mgSideBody')).not.toContainText('tasto spostato a destra');
  });
});
