// Verifica locale «lavori locali», giro 2, rilievo 5: lo strumento con cui la sessione mette o toglie il segno locale
// accetta il NUMERO della pratica, come gli strumenti fratelli. Solo prove a vuoto (--dry-run) sul server vero, token
// dell'owner (senza si salta). Non apre Filo.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('«togli il segno locale al #910», scritto col numero, non risponde «inesistente»', async () => {
  const { findAdminRefreshToken } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  const r = spawnSync(process.execPath, ['scripts/owner-feedback.mjs', '910', '--non-locale', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  const uscita = `${r.stdout}\n${r.stderr}`;
  expect(uscita).not.toMatch(/inesistente/);
  expect(r.status, uscita).toBe(0);
  expect(uscita).toMatch(/toglierei il segno/);
});
