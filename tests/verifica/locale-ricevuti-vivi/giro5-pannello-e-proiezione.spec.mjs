// Verifica giro 5 (ramo riallineato su main): il giro dal vivo con le righe vere (proiezione senza
// conversazione) e il pannello aperto su una pratica che cambia sezione e riceve un turno nuovo.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, extra = {}) {
  return {
    _id: id, _updateTime: 't1',
    text: `Testo del feedback ${id}.`,
    name: `Il menu della copertina si chiude da solo ${id}`,
    seq: 515, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'working', statusPublic: 'open',
    notes: 'Primo turno della lavorazione: TURNO-UNO.',
    ...extra,
  };
}

async function apri(openTab, docs) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__stato = { docs: Object.fromEntries(docs.map((d) => [d._id, d])), dettagli: 0 };
    const proietta = (d) => { const { notes, ...r } = d; return { ...r, _proiezione: true }; };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__stato.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean).map(proietta),
      getDettagli: async (ids) => {
        window.__stato.dettagli += 1;
        return ids.map((id) => window.__stato.docs[id]).filter(Boolean).map((d) => ({ ...d }));
      },
    });
    window.__mgTest.setData(Object.values(window.__stato.docs).map(proietta), { dalVivo: true });
    window.__mgTest.setLiveTiming({ pollMs: 400, clockMs: 150, rientroMs: 150 });
  }, { docs });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

test('pannello aperto, la pratica si ferma al cancello con un turno nuovo: passa nei Ricevuti e il turno si legge senza ricaricare', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515'), fb('altra', { seq: 600 })]);
  await tab(page, 'queue').click();
  await scheda(page, 'fb515').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetail')).toContainText('TURNO-UNO', { timeout: 10000 });

  await page.evaluate(() => {
    const d = window.__stato.docs.fb515;
    window.__stato.docs.fb515 = {
      ...d, _updateTime: 't2', status: 'design', statusReason: 'l5',
      notes: `${d.notes}\n\nSecondo turno: fermato dal cancello di fusione, TURNO-DUE.`,
    };
  });
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetail')).toContainText('TURNO-DUE', { timeout: 10000 });
  await expect(page.locator('#mgDetail')).toContainText('TURNO-UNO');
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
});

test('righe vere dal giro: una pratica ferma al cancello entra nei Ricevuti anche se nessuno la apre, e aprirla mostra la conversazione intera', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515'), fb('altra', { seq: 600 })]);
  await tab(page, 'queue').click();
  await expect(tab(page, 'queue')).toContainText('(2)');
  await page.evaluate(() => {
    const d = window.__stato.docs.fb515;
    window.__stato.docs.fb515 = { ...d, _updateTime: 't2', status: 'design', statusReason: 'l5', notes: `${d.notes}\n\nTURNO-DUE.` };
  });
  await expect(tab(page, 'inbox')).toContainText('(1)', { timeout: 10000 });
  await expect(tab(page, 'queue')).toContainText('(1)');
  await tab(page, 'inbox').click();
  await scheda(page, 'fb515').click();
  await expect(page.locator('#mgDetail')).toContainText('TURNO-DUE', { timeout: 10000 });
});
