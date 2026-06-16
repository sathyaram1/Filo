// I ritrovamenti automatici delle routine cloud (audit proattivo, clientId
// "routine:<slug>" con stato `new`) devono comparire nella tab "Agente" —
// insieme ai ritrovamenti dell'agente esploratore LLM — NON in "Ricevuti", così
// non annegano i feedback dei tester reali. In più la dashboard colora ogni card
// per ORIGINE: arancione (tester esterno), verde (invio dell'owner), blu (audit
// routine), accento (agente esploratore).
//
// Pre-condizione che senza il fix fallirebbe: prima `isAgent` riconosceva solo
// "agent:", quindi un audit "routine:"+`new` finiva in "Ricevuti" e nessuna card
// portava la classe d'origine. Gli assert sotto diventano rossi rimuovendo il fix.
//
// Tutto in UN test su una sola pagina: la fixture Electron è worker-scoped e i
// tab feedback si accumulano tra test, quindi un selettore globale potrebbe
// pescare le card di un tab sorella (limite multi-WebContentsView noto, vedi
// CLAUDE.md). Una pagina sola = conteggi deterministici. Stubbiamo
// SN_FEEDBACK.list per restare offline: categorizzazione e classi d'origine
// sono pura resa client, non servono admin né Firestore.

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

test('audit routine → tab Agente, sub-feedback → Da risolvere, card colorate per origine', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // --- Tab "Ricevuti" (default): solo i due feedback umani, NON l'audit. ---
  await expect(page.locator('.fb-card')).toHaveCount(2);
  await expect(page.locator('.fb-card', { hasText: 'cronologia stato vuoto' })).toHaveCount(0);
  // Colore per origine: owner → verde (origin-owner), tester → arancione (origin-user).
  await expect(page.locator('.fb-card--origin-owner')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-owner')).toContainText('bottone condividi');
  await expect(page.locator('.fb-card--origin-user')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-user')).toContainText('incolla immagini');

  // --- Tab "Agente": c'è solo l'audit della routine, col badge giusto. ---
  await page.locator('[data-tab="agent"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  const auditCard = page.locator('.fb-card');
  await expect(auditCard).toContainText('cronologia stato vuoto');
  await expect(auditCard).toContainText('#200');
  await expect(auditCard.locator('.fb-badge--model')).toContainText('audit');
  await expect(auditCard.locator('.fb-badge--model')).toContainText('nightly-audit');
  // Origine blu (routine), distinta dall'accento dell'agente esploratore: sulla
  // card e sulla bolla-segnalazione (per la tinta). Scoping sotto la card per
  // robustezza.
  await expect(auditCard).toHaveClass(/fb-card--origin-routine/);
  await expect(auditCard.locator('.fb-bubble--report')).toHaveClass(/fb-bubble--origin-routine/);
  // Traccia visiva (tests/.shots/ è gitignorata).
  await page.screenshot({ path: 'tests/.shots/feedback-agent-tab.png' }).catch(() => {});

  // --- Tab "Da risolvere": il sub-feedback di routine (todo) NON è in Agente,
  // ed è reso come task normale col suo numero #22.1. ---
  await page.locator('[data-tab="todo"]').click();
  const todoCard = page.locator('.fb-card');
  await expect(todoCard).toHaveCount(1);
  await expect(todoCard).toContainText('#22.1');
  await expect(todoCard).toContainText('rotazione chiavi');
});
