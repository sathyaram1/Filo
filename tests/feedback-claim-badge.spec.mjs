// La dashboard mostra "🔧 in lavorazione" sui feedback su cui una routine ha un
// claim (semaforo) ancora valido, e NON lo mostra quando il claim manca o è
// scaduto. I dati arrivano stubbando SN_FEEDBACK.list: niente Firestore live,
// si asserisce il rendering vero del badge.
//
// Senza il fix il campo claimExpiresAt non veniva renderizzato: questi assert
// (badge presente solo dove il claim è vivo) diventano rossi se la logica di
// scadenza/visualizzazione regredisce.

import { test, expect } from './fixtures/electron.mjs';

const future = new Date(Date.now() + 30 * 60000).toISOString();
const past = new Date(Date.now() - 5 * 60000).toISOString();

const FAKE = [
  {
    _id: 'live', text: 'Feedback in lavorazione da una routine', name: 'in corso',
    seq: 30, subSeq: 0, status: 'todo', createdAt: '2026-06-12T11:00:00Z',
    claimedBy: 'routine-1', claimExpiresAt: future, claimNum: '#30',
  },
  {
    _id: 'free', text: 'Feedback libero, nessuna routine sopra', name: 'libero',
    seq: 31, subSeq: 0, status: 'todo', createdAt: '2026-06-12T10:30:00Z',
  },
  {
    _id: 'expired', text: 'Feedback con claim scaduto', name: 'scaduto',
    seq: 32, subSeq: 0, status: 'todo', createdAt: '2026-06-12T10:00:00Z',
    claimedBy: 'routine-zombie', claimExpiresAt: past,
  },
];

test('dashboard: badge "in lavorazione" solo dove il claim è vivo', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');
  // Vai sul tab "Da risolvere" dove vivono i todo.
  await page.click('[data-tab="queue"]');
  await expect(page.locator('.fb-card')).toHaveCount(3);

  // Un solo badge in tutta la lista: quello del feedback con claim vivo.
  await expect(page.locator('.fb-claim')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/feedback-claim-badge.png' }).catch(() => {});

  // Il badge sta sulla card "in corso", non su "libero" né "scaduto".
  const liveCard = page.locator('.fb-card', { hasText: 'in corso' });
  await expect(liveCard.locator('.fb-claim')).toHaveCount(1);
  await expect(page.locator('.fb-card', { hasText: 'libero' }).locator('.fb-claim')).toHaveCount(0);
  await expect(page.locator('.fb-card', { hasText: 'scaduto' }).locator('.fb-claim')).toHaveCount(0);
});
