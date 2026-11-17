// La cartella di Claude con le tracce dei sotto-agenti di una sessione, come Claude Code la scrive: `agent-<id>.jsonl`
// e accanto il meta, con `parentAgentId` per i figli di un agente e `finished` quando l'agente ha chiuso.

import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from './percorsi.mjs';

/** `agenti`: [{ id, padre?, finito?, faMin?, tipo?, descrizione? }]. Torna la cartella da passare come CLAUDE_CONFIG_DIR. */
export function claudeConSottoAgenti(sessione, agenti) {
  const dir = cartellaTemporanea('filo-sotto-agenti-');
  const sub = join(dir, 'projects', '-home-user-Filo', sessione, 'subagents');
  mkdirSync(sub, { recursive: true });
  for (const a of agenti) {
    const meta = { agentType: a.tipo || 'general-purpose', description: a.descrizione || '', spawnDepth: a.padre ? 2 : 1 };
    if (a.padre) meta.parentAgentId = a.padre;
    if (a.finito) meta.finished = true;
    const traccia = join(sub, `agent-${a.id}.jsonl`);
    writeFileSync(join(sub, `agent-${a.id}.meta.json`), JSON.stringify(meta));
    writeFileSync(traccia, `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: [] } })}\n`);
    const quando = new Date(Date.now() - (a.faMin || 0) * 60000);
    utimesSync(traccia, quando, quando);
  }
  return dir;
}
