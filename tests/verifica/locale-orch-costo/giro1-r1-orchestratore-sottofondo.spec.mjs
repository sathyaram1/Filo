// Giro locale orch-costo, rilievo 1: il costo dell'orchestratore con i worker lanciati in sottofondo.
// Claude Code lancia i sotto-agenti in sottofondo per default: la chiamata Agent riceve subito
// «Async agent launched», e la fine del worker arriva come notifica, non come risultato.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { generaRapporto } from '../../../scripts/session-report.mjs';

const SESS = '11111111-2222-3333-4444-555555555555';
const at = (hms) => `2026-10-07T${hms}.000Z`;
let n = 0;
const turno = (hms, { cr = 60000, cw = 1500, extra = [] } = {}) => JSON.stringify({
  type: 'assistant', sessionId: SESS, timestamp: at(hms),
  message: { id: `msg_${++n}`, model: 'claude-opus-5-5', usage: { input_tokens: 3, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: 300 }, content: [{ type: 'text', text: 'ok' }, ...extra] },
});
const lancio = (hms, id) => turno(hms, { extra: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'worker', prompt: 'lavora' } }] });
const risultato = (hms, id, text) => JSON.stringify({ type: 'user', sessionId: SESS, timestamp: at(hms), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const notifica = (hms) => JSON.stringify({ type: 'user', sessionId: SESS, timestamp: at(hms), message: { role: 'user', content: '<task-notification>worker completato</task-notification>' } });

test('r1 con i worker in sottofondo il rapporto conta i turni dell\'orchestratore fra un worker e l\'altro, e l\'attesa lunga che fa scadere la sua cache', async () => {
  const dir = cartellaTemporanea('orch-costo-r1-');
  try {
    const sub = join(dir, SESS, 'subagents');
    mkdirSync(sub, { recursive: true });
    // Primo worker: lanciato alle 10:00:50, finisce alle 11:31 (un'ora e mezza: la cache a un'ora dell'orchestratore scade).
    // Poi l'orchestratore lavora 4 turni (il primo riscrive tutta la cache) e lancia il secondo worker.
    const principale = [
      turno('10:00:00'), turno('10:00:20'), lancio('10:00:50', 'toolu_W1'),
      risultato('10:00:53', 'toolu_W1', 'Async agent launched successfully. agentId: w1'),
      turno('10:01:00'),
      notifica('11:31:05'),
      turno('11:31:10', { cr: 0, cw: 70000 }), turno('11:31:20'), turno('11:31:30'), lancio('11:31:50', 'toolu_W2'),
      risultato('11:31:53', 'toolu_W2', 'Async agent launched successfully. agentId: w2'),
      turno('11:32:00'),
    ];
    writeFileSync(join(dir, `${SESS}.jsonl`), `${principale.join('\n')}\n`);
    const w2 = join(sub, 'agent-w2.jsonl');
    writeFileSync(w2, `${[turno('11:32:05', { cr: 0, cw: 30000 }), turno('11:35:00'), turno('11:40:00', { extra: [{ type: 'tool_use', id: 'toolu_rel', name: 'Bash', input: { command: 'node scripts/routine-channel.mjs release abc --role verifier' } }] })].join('\n')}\n`);
    writeFileSync(join(sub, 'agent-w2.meta.json'), JSON.stringify({ agentType: 'routine-worker', toolUseId: 'toolu_W2', spawnDepth: 1, requestShape: 'background' }));

    const rep = await generaRapporto({ transcript: w2, role: 'verifier' });
    expect(rep.orchestrator).not.toBeNull();
    // Dalla notifica del primo worker al lancio del secondo l'orchestratore ha fatto 4 turni (più quello d'attesa dopo il lancio).
    expect(rep.orchestrator.turns).toBeGreaterThanOrEqual(4);
    // È rimasto fermo un'ora e mezza: la misura dell'attesa deve dirlo.
    expect(rep.orchestrator.attesaPrimaS).toBeGreaterThanOrEqual(3600);
    // E il turno dopo l'attesa ha riscritto la cache.
    expect(rep.orchestrator.rewarmTurns).toBeGreaterThanOrEqual(1);
  } finally {
    togliCartella(dir);
  }
});
