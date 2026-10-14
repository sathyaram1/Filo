// Giro 3, rilievo 2: «Salta il controllo» dell'owner su un lavoro server delle routine. Il salto è un via libera che il
// cancello del server accetta: il lavoro deve arrivare su main con tutte e due le parti, o restare aperto finché il
// server non segue. Chiuso con la sola app, la parte del server non la fonde più nessuno. Non apre Filo.

import { test, expect } from '@playwright/test';
import { SERVER } from './aiuti-giro2.mjs';
import { saltaSuLavoroServer } from './aiuti-giro3.mjs';

test.describe('r2 il salto del controllo su un lavoro server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r2 saltato il controllo, il lavoro non si chiude con la parte del server fuori da main', async () => {
    const s = await saltaSuLavoroServer();
    expect(s.esito && s.esito.ok, `il salto non è andato: ${JSON.stringify(s.esito)}`).toBe(true);
    if (s.chiusa.length) {
      expect(s.serverAvanzato, `pratica chiusa (${JSON.stringify(s.esito)}) con la sola parte dell’app su main di Filo`).toBe(true);
    }
    if (s.appFusa && !s.serverAvanzato) {
      expect(s.stato.lavoroServer, 'app su main e server no: la pratica deve restare un lavoro server da portare avanti').toBe(true);
      expect(s.chiusa).toEqual([]);
    }
  });
});
