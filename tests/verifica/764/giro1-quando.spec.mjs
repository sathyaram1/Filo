// VERIFICA #764, giro 1 — la riga «Quando» del rombo verde di una pratica ferma per domande senza segnalazione
// registrata deve dire il giorno vero dell'ultimo turno di Filo, in ogni giorno del mese e in ogni grafia del
// marcatore; una data che non si legge si mostra com'è scritta, mai una riga vuota.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

const base = {
  text: 'Salva immagine.', name: 'Salva immagine', subSeq: 0, status: 'design', statusReason: 'clarify',
  clientId: 'local:claude', createdAt: '2026-09-01T08:00:00Z', images: [],
};
const conv = (...marcatori) => {
  const righe = ['Quale immagine intendi?', '--- La tua risposta del 01/09/26, 09:00 ---', 'Quelle dentro.'];
  marcatori.forEach((m, i) => righe.push(m.startsWith('---') ? m : `--- Filo ha risposto il ${m} ---`, `Domanda ${i + 1}?`));
  return righe.join('\n');
};

const CASI = [
  ['q13', conv('13/09/26, 11:00'), '13/09/2026 11:00'],
  ['q31', conv('31/10/26, 23:59'), '31/10/2026 23:59'],
  ['q4cifre', conv('27/09/2026, 11:00'), '27/09/2026 11:00'],
  ['qcorto', conv('5/9/26, 9:05'), '05/09/2026 09:05'],
  ['qsecondi', conv('12/09/26 11:00:30'), '12/09/2026 11:00'],
  ['qlegacy', conv("--- Aggiornamento dell'agente del 30/09/26, 18:45 ---"), '30/09/2026 18:45'],
  ['qultimo', conv('01/09/26, 10:00', '28/09/26, 16:20'), '28/09/2026 16:20'],
  ['qillegg', conv('23/09'), '23/09'],
];

async function apri(page, feedbacks) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
}

test('«Quando» del rombo verde: il giorno vero dell’ultimo turno, in ogni grafia del marcatore', async ({ openTab }) => {
  const fbs = CASI.map(([id, notes], i) => ({ ...base, _id: `fb-${id}`, seq: 900 + i, notes }));
  const page = await openTab(MANAGE);
  await apri(page, fbs);
  for (const [id, , atteso] of CASI) {
    await page.evaluate((i) => window.__mgTest.openDetail(i), `fb-${id}`);
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
    await expect(page.locator('#mgSideTitle')).toHaveText('Domande di Claude');
    await expect(page.locator('#mgSideBody .mg-liv-riga', { hasText: 'Quando' }), id).toHaveText(`Quando:${atteso}`);
  }
  await page.screenshot({ path: 'tests/.shots/verifica-764-quando.png' });
});
