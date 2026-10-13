// #1211 giro 1 — leggere l'uscita di un proprio comando lanciato in sottofondo è leggere l'uscita di Bash, che non
// sporca: il biglietto della sessione resta pulito.
import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gancio } from '../../../scripts/lib/letture-esterne.mjs';
import { SESSIONE, annotate, envPulito, repoConBiglietto } from './aiuto.mjs';

test('r1 la Read dell\'uscita di un comando in sottofondo non sporca il biglietto', () => {
  const repo = repoConBiglietto();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const cartellaProgetto = repo.replace(/[^A-Za-z0-9]/g, '-');
  const uscita = join(tmpdir(), `claude-${uid}`, cartellaProgetto, 'tasks', 'b1x2y3.output');
  const avviate = [];
  const r = gancio({
    input: { session_id: SESSIONE, cwd: repo, tool_name: 'Read', tool_input: { file_path: uscita } },
    env: envPulito(repo),
    avvia: (p) => avviate.push(p),
  });
  expect(r.esito, JSON.stringify(r)).toBe('nessuna lettura esterna');
  expect(annotate(repo)).toEqual([]);
  expect(avviate).toEqual([]);
});
