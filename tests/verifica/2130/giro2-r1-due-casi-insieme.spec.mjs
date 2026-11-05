// Verifica #2130 giro 2: una riga scritta sotto una versione già uscita alla partenza, e poi main pubblica ancora.
// Lo strumento lanciato per riconoscere il caso non deve dire insieme «è un rilievo» e «non c'è niente da correggere».
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOVITA = 'src/shared/patchNotes.js';
const registro = (righe) => "(function (global) {\n  const NOTES = [\n    {\n      version: '0.2.264', date: '2026-11-04',\n      features: [\n"
  + righe.map((r) => `        { testo: '${r}' },\n`).join('') + '      ],\n    },\n  ];\n  global.SN_PATCH_NOTES = { NOTES };\n})(globalThis);\n';
const manifesto = (v) => `${JSON.stringify({ name: 'x', version: v }, null, 2)}\n`;

test('r1 una riga già sotto una versione uscita alla partenza non viene detta anche «niente da correggere»', () => {
  const dir = cartellaTemporanea('verifica-2130-g2-');
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'prova@filo');
    git('config', 'user.name', 'prova');
    mkdirSync(join(dir, 'src', 'shared'), { recursive: true });
    // Il ramo parte con la 0.2.264 già uscita e scrive lì la sua riga: rilievo vero.
    writeFileSync(join(dir, NOVITA), registro(['a']), 'utf8');
    writeFileSync(join(dir, 'package.json'), manifesto('0.2.264'), 'utf8');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'ramo');
    writeFileSync(join(dir, NOVITA), registro(['a', 'Riga del ramo']), 'utf8');
    git('commit', '-qam', 'ramo');
    // Intanto main pubblica la 0.2.265.
    git('checkout', '-q', 'main');
    writeFileSync(join(dir, 'package.json'), manifesto('0.2.265'), 'utf8');
    git('commit', '-qam', 'pubblicata 0.2.265');
    git('checkout', '-q', 'ramo');

    const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'novita-in-cima.mjs')],
      { cwd: dir, env: { ...process.env, FILO_REPO_ROOT: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    expect(out).toContain('già uscite alla partenza del ramo');
    expect(out).not.toContain('niente da correggere');
    expect(out).not.toContain('in 0.2.265: Riga del ramo');
  } finally {
    togliCartella(dir);
  }
});
