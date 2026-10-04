// Verifica locale cancello-storia, giro 1, rilievo 2: quando i passi di approfondimento finiscono per scaricare
// tutta la storia, il registro deve dirlo («storia scaricata tutta»), non «approfondito» e basta.
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { cloneFinto, unitFinti, g } from './storia-finta.mjs';

const ROOT = resolve(process.cwd());

test('se alla fine il clone non è più poco profondo, la misura dice storia intera', async () => {
  test.setTimeout(300000);
  const m = await import(pathToFileURL(resolve(ROOT, 'scripts/lib/unit-sulla-fusione.mjs')).href);
  const { clone, punta } = cloneFinto(cartellaTemporanea('cancello-storia-r2-'), { clona: ['--depth', '1', '--no-single-branch', '--branch', 'feature'] });
  const r = m.provaUnitSullaFusione({ root: clone, punta, lancia: unitFinti, scrivi: () => {} });
  expect(r.esito).toBe('verde');
  expect(g(clone, ['rev-parse', '--is-shallow-repository'])).toBe('false');
  expect(r.storia.intera, `storia registrata: ${JSON.stringify(r.storia)}`).toBe(true);
});
