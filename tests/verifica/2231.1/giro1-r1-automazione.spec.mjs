// Verifica #2231.1 giro 1: l'«automazione» della regola vecchia era l'azione che accende o spegne una voce di
// Automazioni; la riga nuova la manda alla fermata per un passo locale, pensata per le automazioni GitHub.
import { test, expect } from '@playwright/test';

const { readRoleInstructions } = await import('../../../scripts/dispatch.mjs');
const piatto = (t) => t.replace(/\s+/g, ' ');

for (const [ruolo, opts] of [['new-work', {}], ['fixer', {}], ['verifier', { scope: 'pieno' }]]) {
  test(`r1 ${ruolo}: chi chiede sa dove va un'opzione che accende o spegne una voce di Automazioni`, () => {
    const t = piatto(readRoleInstructions(ruolo, opts));
    const sezione = t.slice(t.indexOf('Ogni opzione deve sbloccare questo lavoro'), t.indexOf('**Una domanda che blocca FERMA il lavoro**'));
    expect(sezione.length).toBeGreaterThan(0);
    // Il rimando alla fermata locale vale per le automazioni GitHub, non per gli interruttori delle routine.
    expect(sezione).not.toMatch(/cambiare un'automazione, segue «Se il lavoro si fa solo in locale»/);
    expect(sezione).toMatch(/`automazione`|Automazioni|accendere o spegnere/);
  });
}
