// Giro 1, rilievo 1: senza la nota del cancello il quadrato non deve spacciare una nota vecchia per il motivo della fermata.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const NOTA_CANCELLO = 'Il cancello non fonde il ramo del server: la suite di filo-security non è verde. Decidi tu: archiviarlo, o farlo rifare.';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-v1556', name: 'Lavoro del server fermo', text: 'Sistemare il cancello del server.',
    seq: 1255, subSeq: 0, status: 'design', statusReason: 'l5', statusPublic: 'open',
    clientId: 'owner:test', createdAt: '2026-10-20T08:00:00Z', images: [],
    notes: `Report di chi ha risolto: fatto.\n\n--- Aggiornamento dell'agente del 21/10/26, 15:43 ---\n${NOTA_CANCELLO}`,
  }, over);
}

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
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

test('r1 una nota vecchia di un agente non passa per il motivo della fermata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const notes = 'Report di chi ha risolto: ho messo il tasto in alto.\n\n'
    + "--- Aggiornamento dell'agente del 19/10/26, 10:00 ---\nHo una domanda: il tasto lo preferisci a destra o a sinistra?\n\n"
    + "--- La tua risposta del 19/10/26, 11:00 ---\nA destra.\n\n"
    + "--- Aggiornamento dell'agente del 20/10/26, 09:00 ---\nReport: tasto spostato a destra, prove verdi.";
  await apri(page, [pratica({ notes })]);
  await apriQuadrato(page, 'fb-v1556');
  const body = page.locator('#mgSideBody');
  await expect(page.locator('#mgL5RimandaBtn')).toBeVisible();
  await expect(body).not.toContainText('tasto spostato a destra');
  await expect(body).toContainText('Nessuna richiesta di fusione è aperta');
});
