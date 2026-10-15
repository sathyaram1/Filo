// Verifica #785 giro 1: l'impronta scritta nella pagina deve essere quella del file che GitHub serve davvero,
// e la riga «come controllare» deve funzionare anche sui Linux senza shasum.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import * as M from '../../../scripts/release-impronte.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CORSA = 'https://github.com/own/Filo/actions/runs/123';
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Un gh finto che risponde solo con i campi chiesti, come quello vero; GitHub dichiara per ogni allegato il suo digest.
function releaseFinta(digest) {
  const stato = { corpo: 'Note.' };
  const gh = (args) => {
    if (args[1] === 'view') {
      const campi = args[args.indexOf('--json') + 1].split(',');
      const tutto = { body: stato.corpo, isDraft: false, assets: Object.entries(digest).map(([name, d]) => ({ name, digest: `sha256:${d}` })) };
      return JSON.stringify(Object.fromEntries(campi.map((c) => [c, tutto[c]])));
    }
    if (args[1] === 'edit') { stato.corpo = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8'); return ''; }
    throw new Error('comando inatteso');
  };
  return { gh, stato };
}

const argv = (dir) => ['--piattaforma', 'Linux', '--cartella', dir, '--versione', 'v9.9.9', '--repo', 'own/Filo',
  '--commit', COMMIT, '--corsa', CORSA];

test('r1 se GitHub serve un file con un\'altra impronta, la pagina non riporta quella del file locale come se fosse giusta', async () => {
  const dir = cartellaTemporanea('filo-verifica-785-');
  try {
    writeFileSync(join(dir, 'Filo-Linux.AppImage'), 'il file costruito qui');
    const { gh, stato } = releaseFinta({ 'Filo-Linux.AppImage': sha('un file diverso, quello caricato davvero') });
    let fallito = false;
    try { await M.esegui({ argv: argv(dir), gh, attendi: async () => {} }); } catch { fallito = true; }
    expect(fallito, 'il passo deve fermarsi: chi scarica confronterebbe un\'impronta che il suo file non ha').toBe(true);
    expect(stato.corpo).not.toContain(sha('il file costruito qui'));
  } finally {
    togliCartella(dir);
  }
});

test('r2 la riga su come controllare dà anche un comando che c\'è su ogni Linux', () => {
  expect(M.COME_CONTROLLARE).toMatch(/sha256sum/);
});
