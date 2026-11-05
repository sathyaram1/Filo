// Verifica #1514 giro 4, rilievo 1: un mai giudicato dei Ricevuti si rifiuta di serie alla sessione che lo legge (spesso
// un agente, come chi scrive le schede); il rifiuto non deve consegnarle la strada per leggerlo lo stesso.
import { test, expect } from '@playwright/test';

test('r1 il rifiuto di un mai giudicato dei Ricevuti non dice alla sessione come leggerlo lo stesso', async () => {
  const { vietatoLeggere } = await import('../../../scripts/leggi-feedback.mjs');
  const casi = [
    ['unlabeled', { l1Category: 'spam', action: 'human_review' }, ''],
    ['unlabeled', { verdicts: [{ class: 'ok' }], l2Degraded: true }, ''],
    ['design', undefined, ''],
  ];
  for (const [stato, giudizio, fiducia] of casi) {
    const motivo = vietatoLeggere(stato, giudizio, fiducia);
    expect(motivo, `${stato}: rifiutato`).not.toBe('');
    expect(motivo, `${stato}: il rifiuto consegna l'opzione per scavalcarlo`).not.toContain('--anche-mai-giudicato');
  }
});
