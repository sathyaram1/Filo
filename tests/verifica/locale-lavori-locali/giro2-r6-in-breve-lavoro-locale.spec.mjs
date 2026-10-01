// Verifica locale «lavori locali», giro 2, rilievo 6: un feedback d'utente che una sessione rimanda nei Ricevuti perché
// richiede lavoro locale non si presenta in Gestione come un giudizio di design dei giudici. Logica pura, non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('«In breve» di un feedback rimandato per lavoro locale dice il motivo vero', async () => {
  await imp('src/shared/feedbackThread.js');
  await imp('src/shared/feedbackStatus.js');
  await imp('src/shared/manageReview.js');
  const MR = globalThis.SN_MANAGE_REVIEW;
  const fb = { status: 'design', statusReason: 'locale', clientId: 'tester@example.com',
    pipeline: { verdicts: [{ class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }] } };
  const nota = MR.judgesNote(fb);
  expect(nota && nota.text).not.toMatch(/giudici/i);
  expect(nota && nota.text).toMatch(/locale/i);
});
