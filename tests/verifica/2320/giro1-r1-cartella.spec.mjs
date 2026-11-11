// #2320 giro 1: lanciato dal clone, lo strumento delle novità lavora su un'altra cartella (quella fissata con gli
// strumenti) e risponde «nessuna riga» senza dire quale ha letto: chi lo lancia non distingue un clone pulito da uno sbagliato.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RIGA = 'Riga del ramo r1-2320 sotto una versione uscita';

const registro = (righe269) => `(function (global) {
  const NOTES = [
    {
      version: '0.2.270', date: '2026-11-07',
      fixes: ['Una correzione'],
    },
    {
      version: '0.2.269', date: '2026-11-06',
      features: [${righe269.map((r) => JSON.stringify(r)).join(', ')}],
    },
  ];
  global.SN_PATCH_NOTES = { NOTES };
})(globalThis);
`;

test('r1 lanciato dal clone, lo strumento lavora sul clone o dice su quale cartella ha lavorato', () => {
  const clone = cartellaTemporanea('novita-clone-');
  const git = (args) => execFileSync('git', ['-c', 'user.name=v', '-c', 'user.email=v@v', ...args], { cwd: clone, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', clone, 'config', 'commit.gpgsign', 'false']);
  writeFileSync(join(clone, 'package.json'), JSON.stringify({ name: 'x', version: '0.2.269' }));
  mkdirSync(join(clone, 'src', 'shared'), { recursive: true });
  writeFileSync(join(clone, 'src', 'shared', 'patchNotes.js'), registro(['Di main']));
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  git(['checkout', '-qb', 'lavoro']);
  writeFileSync(join(clone, 'src', 'shared', 'patchNotes.js'), registro(['Di main', RIGA]));
  git(['commit', '-qam', 'riga del ramo']);

  const env = { ...process.env };
  delete env.FILO_REPO_ROOT;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'novita-in-cima.mjs')], { cwd: clone, env, encoding: 'utf8' });
  const uscita = `${r.stdout}\n${r.stderr}`;
  const sulClone = uscita.includes('r1-2320');
  const diceDove = uscita.includes(ROOT) || /cartella|clone/i.test(uscita);
  expect(sulClone || diceDove, `uscita: ${uscita}`).toBe(true);
});
