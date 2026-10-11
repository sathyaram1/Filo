// Verifica locale «clone-worker», giro 5, rilievo 1: il clone di un worker deve nascere anche quando il principale ha
// l'indice dei commit di git (commit-graph) che copre la cima del ramo, come dopo la manutenzione automatica di git.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { preparaClone, togliClone } from '../../../scripts/lib/clone-worker.mjs';

test.setTimeout(5 * 60_000);

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// L'origin del principale è un URL, come quello di GitHub: con un percorso semplice git copierebbe gli oggetti da sé
// e il caso non si vedrebbe.
function canarino() {
  const radice = cartellaTemporanea('filo-v1157-grafo-');
  const seme = join(radice, 'seme');
  mkdirSync(seme, { recursive: true });
  git(seme, 'init', '-q', '-b', 'main');
  writeFileSync(join(seme, 'package.json'), '{"name":"canarino","version":"1.0.0"}\n');
  writeFileSync(join(seme, 'package-lock.json'), '{"name":"canarino","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');
  writeFileSync(join(seme, '.gitignore'), 'node_modules\n');
  git(seme, 'add', '-A');
  git(seme, '-c', 'user.email=v@v', '-c', 'user.name=v', 'commit', '-qm', 'seme');
  const origine = join(radice, 'origine.git');
  git(radice, 'clone', '-q', '--bare', seme, origine);
  const principale = join(radice, 'principale');
  git(radice, 'clone', '-q', pathToFileURL(origine).href, principale);
  mkdirSync(join(principale, 'node_modules', 'finto'), { recursive: true });
  writeFileSync(join(principale, 'node_modules', 'finto', 'index.js'), 'module.exports = 1;\n');
  return { radice, principale };
}

test('r1 il clone del worker nasce col principale che ha l’indice dei commit sulla cima del ramo', () => {
  const { radice, principale } = canarino();
  git(principale, 'commit-graph', 'write', '--reachable');
  const opzioni = { base: join(radice, 'cloni'), basePin: join(radice, 'strumenti'), registra: false };
  const r = preparaClone(principale, 1, opzioni);
  try {
    expect(r.why).toBe('');
    expect(r.ok).toBe(true);
    expect(existsSync(join(r.dir, 'package.json'))).toBe(true);
  } finally {
    if (r.ok) togliClone(principale, 1, opzioni);
  }
});
