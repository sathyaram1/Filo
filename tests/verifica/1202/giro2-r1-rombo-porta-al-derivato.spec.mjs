// #1202 giro 2 — dal rombo di una segnalazione uscita a parte si arriva al feedback dove aspetta la risposta.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

const PADRE = {
  _id: 'fb-1202-padre', text: 'Il menu si apre lento.', name: 'Menu lento',
  seq: 705, subSeq: 0, status: 'revision_capability', branch: 'worker/fb-1202-padre',
  clientId: 'user:abc', createdAt: '2026-10-12T10:00:00Z', images: [],
  notes: 'Fatto con la strada A.\n\nSegnalazione per l\'owner (chi risolve), uscita senza fermare il lavoro nel feedback derivato #705.1:\n## Problema\nPrecaricare costa qualche credito.',
  livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-10-12T10:05:00Z', testo: '## Problema\nPrecaricare costa qualche credito.', derivato: '#705.1' } },
};
const FIGLIO = {
  _id: 'fb-1202-figlio', name: 'Da decidere: la scelta segnalata da chi risolve su #705',
  text: 'Segnalato da chi risolve lavorando su #705: una scelta che spetta all\'owner, livello 2.\nCHIEDE UNA DECISIONE DELL\'OWNER.\n\nPrecarica o aspetta: domanda unica del figlio.',
  seq: 705, subSeq: 1, status: 'unlabeled', parentId: 'fb-1202-padre', derived: true, child: true,
  clientId: 'routine:residuo', createdAt: '2026-10-12T10:05:01Z', images: [],
};

async function apri(page, feedbacks) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
}

test('r1 il numero del feedback derivato nel rombo porta a quel feedback, dove l\'owner risponde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [PADRE, FIGLIO]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), PADRE._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  const riga = page.locator('#mgSideBody .mg-liv-riga', { hasText: 'Domanda nel feedback' });
  await expect(riga).toContainText('#705.1');
  await riga.getByText('#705.1').click();
  // Successo per l'owner: davanti ha il feedback figlio, con la domanda a cui rispondere.
  await expect(page.getByText('domanda unica del figlio')).toBeVisible({ timeout: 5000 });
});
