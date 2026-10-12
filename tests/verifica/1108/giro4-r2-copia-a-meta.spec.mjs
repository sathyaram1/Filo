// #1108 giro 4 — una copia della risposta del server tagliata prima della fine del primo documento (le prime 50 righe)
// porta già testo, user agent e identificativo di una persona, e il salvataggio la spedisce.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RAMO = 'worker/prova-1108';
const s = (v) => ({ stringValue: v });
// La forma di un documento vero della collezione dei feedback, con valori finti: sedici campi, uno lungo in testa.
const DOCUMENTO = {
  name: 'projects/progetto-finto/databases/(default)/documents/feedback/0000-finto',
  fields: {
    subSeq: { integerValue: '0' }, images: { arrayValue: {} }, pipeline: s(`FENC1:${'x'.repeat(2000)}`),
    createdAt: { timestampValue: '2026-07-01T10:00:00Z' }, url: s('https://esempio.invalid/pagina'), priority: { integerValue: '2' },
    name: s('Persona Finta'), seq: { integerValue: '1' }, statusPublic: s('ricevuto'), text: s('testo finto di una persona'),
    notes: s(''), status: s('ricevuto'), title: s('titolo finto'), userAgent: s('Mozilla/5.0 finto'), clientId: s('cid-finto'),
    files: { arrayValue: {} },
  },
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('r2 le prime 50 righe di una risposta del server sui feedback non arrivano su origin', () => {
  const dir = cartellaTemporanea('filo-1108-');
  const origin = join(dir, 'origin.git');
  const wt = join(dir, 'wt');
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-q', '-b', 'main', wt]);
    writeFileSync(join(wt, 'a.txt'), 'a\n');
    git(wt, 'add', '-A'); git(wt, 'commit', '-qm', 'base');
    git(wt, 'remote', 'add', 'origin', origin);
    git(wt, 'push', '-q', 'origin', 'main:refs/heads/main');
    git(wt, 'checkout', '-qb', RAMO);
    git(wt, 'push', '-q', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
    git(wt, 'fetch', '-q', 'origin');
    const intera = JSON.stringify({ documents: [DOCUMENTO, DOCUMENTO] }, null, 2).split('\n');
    const pezzo = intera.slice(0, 50).join('\n');
    expect(pezzo).toContain('cid-finto');
    writeFileSync(join(wt, 'fb-pagina1.json'), pezzo);
    writeFileSync(join(wt, 'b.txt'), 'b\n');
    const ingresso = JSON.stringify({ hook_event_name: 'PostToolUse', tool_input: { file_path: join(wt, 'b.txt') }, cwd: wt });
    execFileSync('bash', [join(REPO, '.claude/hooks/auto-commit-merge.sh')], {
      cwd: wt, input: ingresso, encoding: 'utf8', env: { ...process.env, FILO_ROUTINE: '1', CLAUDE_PROJECT_DIR: wt },
    });
    const spedito = git(origin, 'log', '--all', '--format=', '--name-only');
    expect(spedito).toContain('b.txt');
    expect(spedito).not.toContain('fb-pagina1.json');
  } finally { togliCartella(dir); }
});
