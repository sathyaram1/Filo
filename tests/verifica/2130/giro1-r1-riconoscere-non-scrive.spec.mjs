// Verifica #2130 giro 1: chi verifica o legge il diff lancia lo strumento delle novità SENZA --commit solo per
// riconoscere il caso; se il ramo ha una riga sotto una versione già uscita alla partenza, il suo ramo non deve cambiare.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOVITA = 'src/shared/patchNotes.js';

test('r1 lo strumento lanciato per riconoscere il caso non modifica il registro del ramo', () => {
  const dir = cartellaTemporanea('verifica-2130-');
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'prova@filo');
    git('config', 'user.name', 'prova');
    mkdirSync(join(dir, 'src', 'shared'), { recursive: true });
    const registro = readFileSync(join(REPO, NOVITA), 'utf8');
    writeFileSync(join(dir, NOVITA), registro, 'utf8');
    const cima = /version: '(\d+\.\d+\.\d+)'/.exec(registro)[1];
    // Il blocco in cima è già uscito quando il ramo parte: la riga del ramo sotto di lui è un rilievo vero.
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'x', version: cima }, null, 2)}\n`, 'utf8');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'ramo');
    const conRiga = registro.replace('      fixes: [\n', "      fixes: [\n        { testo: 'Riga del ramo.', segnalazione: 2130 },\n");
    expect(conRiga).not.toBe(registro);
    writeFileSync(join(dir, NOVITA), conRiga, 'utf8');
    git('commit', '-qam', 'ramo');

    execFileSync(process.execPath, [join(REPO, 'scripts', 'novita-in-cima.mjs')],
      { cwd: dir, env: { ...process.env, FILO_REPO_ROOT: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    expect(git('status', '--porcelain')).toBe('');
    expect(readFileSync(join(dir, NOVITA), 'utf8')).toBe(conRiga);
  } finally {
    togliCartella(dir);
  }
});
