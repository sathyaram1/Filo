// Verifica #2304 giro 1: nell'orchestratore locale il worker è la sessione principale (`claude -p`), e i suoi
// sotto-agenti nascono senza agente padre nel meta. L'attesa deve vederli lo stesso, o dice «finito» mentre lavorano.
import { test, expect } from '@playwright/test';
import { claudeConSottoAgenti } from '../../helpers/sottoAgenti.mjs';
import { togliCartella } from '../../helpers/percorsi.mjs';
import { sottoAgentiVivi } from '../../../scripts/lib/veglia-worker.mjs';

test('r1 un sotto-agente in sottofondo del worker lanciato con claude -p conta come lavoro vivo', () => {
  // Come la scrive Claude Code: un figlio della sessione principale ha spawnDepth 1 e nessun parentAgentId.
  const configDir = claudeConSottoAgenti('sessione-locale-2304', [
    { id: 'c1', tipo: 'Explore', descrizione: 'cercatore' },
  ]);
  try {
    const vivi = sottoAgentiVivi({ sessione: 'sessione-locale-2304', configDir });
    expect(vivi.map((v) => v.descrizione)).toEqual(['cercatore']);
  } finally {
    togliCartella(configDir);
  }
});
