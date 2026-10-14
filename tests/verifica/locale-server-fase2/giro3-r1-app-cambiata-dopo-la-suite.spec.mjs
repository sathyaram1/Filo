// Giro 3, rilievo 1: in un lavoro misto la suite del server prova il ramo omonimo di Filo com'era alla spinta del server.
// Se poi cambia solo la parte dell'app (una correzione), il cancello non deve portare su main una coppia che la suite non
// ha mai visto e che la pubblicazione non regge. Corse di GitHub simulate dai workflow veri; non apre Filo.

import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { SERVER } from './aiuti-giro2.mjs';
import { scenarioMisto } from './aiuti-giro3.mjs';

const tmp = [];
test.afterAll(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } });

test.describe('r1 lavoro misto: la parte dell’app cambiata dopo la suite del server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r1 controllo: con l’app ferma dalla spinta del server la coppia va su main e la pubblicazione la regge', async () => {
    const s = await scenarioMisto({ appDopo: false, tmp });
    expect(s.suite).toBe('success');
    expect(s.serverAvanzato, `il cancello non porta il server su main: ${JSON.stringify(s.risposta)}`).toBe(true);
    expect(s.appFusa).toBe(true);
    expect(s.pubblicazione()).toEqual([]);
  });

  test('r1 una correzione solo nell’app dopo la suite non porta su main una coppia che la pubblicazione ferma alla guardia', async () => {
    const s = await scenarioMisto({ appDopo: true, tmp });
    expect(s.suite, 'la suite del ramo del server, partita prima della correzione, è verde').toBe('success');
    if (s.serverAvanzato || s.appFusa) {
      expect(s.pubblicazione(), 'app e server fusi con una suite che ha provato la parte dell’app di prima: GitHub ferma la pubblicazione dopo il bake e accende l’allarme').toEqual([]);
    }
  });
});
