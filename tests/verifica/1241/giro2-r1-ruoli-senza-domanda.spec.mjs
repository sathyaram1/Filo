// Giro 2 di #1241, rilievo 1: il canale delle routine accetta una domanda solo da chi risolve, corregge o verifica
// (oggi: new-work, fixer, verifier). Chi controlla la sicurezza o esplora, mandato a chiederla, riceve un no certo.
import { test, expect } from '@playwright/test';

const AMMESSI_DAL_SERVER = new Set(['new-work', 'fixer', 'verifier']);

test('r1 a un ruolo che il canale non lascia chiedere, le istruzioni non mandano a chiedere una domanda di guasto', async () => {
  const { readRoleInstructions } = await import('../../../scripts/dispatch.mjs');
  for (const ruolo of ['secaudit', 'prober']) {
    expect(AMMESSI_DAL_SERVER.has(ruolo)).toBe(false);
    const t = readRoleInstructions(ruolo, {}).replace(/\s+/g, ' ');
    // O la ricetta non c'è, o dice a quel ruolo che per lui la domanda non passa e cosa fare al suo posto.
    const mandato = /domanda\.mjs"? chiedi/.test(t);
    const avvisato = /(controllo di sicurezza|secaudit|esplor|prober)[^.]{0,200}(non (può|puoi|apre|passa)|rifiut)/i.test(t);
    expect(!mandato || avvisato, `${ruolo}: mandato a chiedere una domanda che il canale gli rifiuta`).toBe(true);
  }
});
