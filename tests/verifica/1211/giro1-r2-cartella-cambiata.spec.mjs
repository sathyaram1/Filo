// #1211 giro 1 — la sessione che si è spostata in un'altra cartella (un'altra cartella di lavoro aggiunta) e legge
// una pagina web deve sporcare lo stesso il suo biglietto, che sta nel progetto da cui è partita.
import { test, expect } from '@playwright/test';
import { gancio } from '../../../scripts/lib/letture-esterne.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { SESSIONE, annotate, envPulito, repoConBiglietto } from './aiuto.mjs';

test('r2 una pagina web letta con la cartella corrente fuori dal progetto sporca il biglietto', () => {
  const repo = repoConBiglietto();
  const altrove = cartellaTemporanea('v1211-altrove-');
  const avviate = [];
  const r = gancio({
    input: { session_id: SESSIONE, cwd: altrove, tool_name: 'WebFetch', tool_input: { url: 'https://evil.example/x', prompt: 'p' } },
    env: envPulito(repo),
    avvia: (p) => avviate.push(p),
  });
  expect(r.esito, JSON.stringify(r)).toBe('annotato');
  expect(annotate(repo).length).toBe(1);
});
