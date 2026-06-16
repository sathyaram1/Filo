// I ritrovamenti automatici delle routine cloud (audit proattivo, clientId
// "routine:<slug>" con stato `new`) devono comparire nella tab "Agente" —
// insieme ai ritrovamenti dell'agente esploratore LLM — NON in "Ricevuti", così
// non annegano i feedback dei tester reali. In più la dashboard colora ogni card
// per ORIGINE: arancione (tester esterno), verde (invio dell'owner), blu (audit
// routine), accento (agente esploratore).
//
// Pre-condizione che senza il fix fallirebbe: prima `isAgent` riconosceva solo
// "agent:", quindi un audit "routine:"+`new` finiva in "Ricevuti" e nessuna card
// portava la classe d'origine. Questi assert diventano rossi rimuovendo il fix.
//
// Come gli altri spec della dashboard, stubbiamo SN_FEEDBACK.list per restare
// deterministici e offline: la categorizzazione e le classi d'origine sono pura
// resa client, non serve admin né Firestore.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const FAKE = [
  {
    // Audit di una routine cloud → tab "Agente".
    _id: 'audit1',
    text: 'Lo stato vuoto della cronologia non ha messaggio',
    name: 'cronologia stato vuoto',
    seq: 200,
    subSeq: 0,
    status: 'new',
    clientId: 'routine:nightly-audit',
    createdAt: '2026-06-15T11:00:00Z',
  },
  {
    // Sub-feedback di una routine: stesso prefisso ma stato `todo` → NON è un
    // ritrovamento d'agente, vive in "Da risolvere" come task normale.
    _id: 'sub1',
    text: 'Implementare la rotazione automatica delle chiavi',
    name: 'rotazione chiavi',
    seq: 22,
    subSeq: 1,
    status: 'todo',
    clientId: 'routine:feedback-routine',
    createdAt: '2026-06-14T11:00:00Z',
  },
  {
    // Invio manuale dell'owner (admin loggato) → "Ricevuti", card verde.
    _id: 'owner1',
    text: 'Il bottone condividi è troppo piccolo',
    name: 'bottone condividi piccolo',
    seq: 199,
    subSeq: 0,
    status: 'new',
    clientId: 'owner:abc-123',
    createdAt: '2026-06-15T10:00:00Z',
  },
  {
    // Alpha tester esterno → "Ricevuti", card arancione.
    _id: 'user1',
    text: 'Non riesco a incollare immagini nella chat',
    name: 'incolla immagini chat',
    seq: 198,
    subSeq: 0,
    status: 'new',
    clientId: 'tester-xyz',
    createdAt: '2026-06-15T09:00:00Z',
  },
];

async function loadFakes(page) {
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => {
    SN_FEEDBACK.list = async () => items;
  }, FAKE);
  await page.click('#refresh');
}

test('audit di una routine compare nella tab "Agente", non in "Ricevuti"', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await loadFakes(page);

  // Default = "Ricevuti": ci sono solo i due feedback umani (owner + tester),
  // NON l'audit della routine.
  await expect(page.locator('.fb-card')).toHaveCount(2);
  await expect(page.locator('.fb-card')).not.toContainText('cronologia stato vuoto');

  // Tab "Agente": l'audit c'è, col badge che lo marca come audit di routine.
  await page.locator('[data-tab="agent"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  const card = page.locator('.fb-card');
  await expect(card).toContainText('cronologia stato vuoto');
  await expect(card).toContainText('#200');
  await expect(card.locator('.fb-badge--model')).toContainText('audit');
  await expect(card.locator('.fb-badge--model')).toContainText('nightly-audit');
  // Traccia visiva (tests/.shots/ è gitignorata).
  await page.screenshot({ path: 'tests/.shots/feedback-agent-tab.png' }).catch(() => {});
});

test('un sub-feedback di routine (todo) resta in "Da risolvere", non in "Agente"', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await loadFakes(page);

  // NON è nella tab Agente (lì c'è solo l'audit `new`).
  await page.locator('[data-tab="agent"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(page.locator('.fb-card')).not.toContainText('rotazione chiavi');

  // È in "Da risolvere", reso come task normale col suo numero #22.1.
  await page.locator('[data-tab="todo"]').click();
  const card = page.locator('.fb-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('#22.1');
  await expect(card).toContainText('rotazione chiavi');
});

test('le card sono colorate per origine: owner verde, tester arancione, audit blu', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await loadFakes(page);

  // Ricevuti: owner → origin-owner, tester esterno → origin-user.
  await expect(page.locator('.fb-card--origin-owner')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-owner')).toContainText('bottone condividi');
  await expect(page.locator('.fb-card--origin-user')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-user')).toContainText('incolla immagini');

  // Agente: l'audit della routine → origin-routine (blu), distinto dall'accento
  // dell'agente esploratore.
  await page.locator('[data-tab="agent"]').click();
  await expect(page.locator('.fb-card--origin-routine')).toHaveCount(1);
  // La bolla-segnalazione porta la stessa classe d'origine (per la tinta).
  await expect(page.locator('.fb-bubble--report.fb-bubble--origin-routine')).toHaveCount(1);
});
