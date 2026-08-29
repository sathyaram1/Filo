// I ritrovamenti automatici — agente esploratore LLM (clientId "agent:<model>")
// e audit proattivo di una routine cloud (clientId "routine:<slug>" ancora da
// triagiare) — restano isolabili sulla pagina dei feedback: dal #509 non con una
// SEZIONE tutta loro (che la dashboard di gestione non ha, e che faceva contare
// "Ricevuti" in modo diverso sulle due pagine) ma col filtro "Solo automatici".
// In più la pagina colora ogni card per ORIGINE: arancione (tester esterno),
// verde (invio dell'owner), blu (audit routine), accento (agente esploratore).
//
// Pre-condizione che senza il fix fallirebbe: `isAgent` guardava lo status
// grezzo (`=== 'new'`), quindi un audit già normalizzato (`unlabeled`) non
// veniva riconosciuto e il filtro non lo pescava; e i sub-feedback di routine
// (todo) non devono entrarci.
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
    // Audit di una routine cloud, ancora da triagiare → ritrovamento automatico.
    _id: 'audit1',
    text: 'Lo stato vuoto della cronologia non ha messaggio',
    name: 'cronologia stato vuoto',
    seq: 200,
    subSeq: 0,
    status: 'unlabeled',
    clientId: 'routine:nightly-audit',
    createdAt: '2026-06-15T11:00:00Z',
  },
  {
    // Sub-feedback di una routine: stesso prefisso ma già in coda → NON è un
    // ritrovamento d'agente, vive in "In coda" come task normale.
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
    status: 'unlabeled',
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
    status: 'unlabeled',
    clientId: 'tester-xyz',
    createdAt: '2026-06-15T09:00:00Z',
  },
];

test('audit routine: filtro "Solo automatici", sub-feedback in coda, card colorate per origine', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // --- "Ricevuti" (default): i tre non ancora triagiati, audit compreso —
  // come nella dashboard di gestione, che non ha una sezione a parte. ---
  await expect(page.locator('.fb-card')).toHaveCount(3);
  // Colore per origine: owner → verde (origin-owner), tester → arancione (origin-user).
  await expect(page.locator('.fb-card--origin-owner')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-owner')).toContainText('bottone condividi');
  await expect(page.locator('.fb-card--origin-user')).toHaveCount(1);
  await expect(page.locator('.fb-card--origin-user')).toContainText('incolla immagini');

  // --- Filtro "Solo automatici": resta il solo audit, col badge giusto. ---
  await page.locator('#agentOnly').check();
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

  // --- "In coda": il sub-feedback di routine NON è un ritrovamento automatico
  // (il filtro non lo pesca), ed è reso come task normale col suo numero #22.1. ---
  await page.locator('#agentOnly').uncheck();
  await page.locator('#tabs [data-tab="queue"]').click();
  const todoCard = page.locator('.fb-card');
  await expect(todoCard).toHaveCount(1);
  await expect(todoCard).toContainText('#22.1');
  await expect(todoCard).toContainText('rotazione chiavi');
  await page.locator('#agentOnly').check();
  await expect(page.locator('.fb-card')).toHaveCount(0);
  await page.locator('#agentOnly').uncheck();
});
