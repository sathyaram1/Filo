// Verifica #1127 giro 1, rilievo 1: una scheda che aspetta in coda non sta caricando, quindi nella barra non gira la
// rotella del caricamento (altrimenti l'utente vede di nuovo tutte le schede «in caricamento insieme»).
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le schede in attesa nella coda della riapertura non mostrano la rotella del caricamento', async () => {
  test.setTimeout(90_000);
  const richieste = new Set();
  const server = createServer((req, res) => {
    richieste.add(req.url);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`);
    }, 6000);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tabs = Array.from({ length: 8 }, (_, i) => `${origin}/p/${i}`);
  const dati = cartellaTemporanea('filo-v1127-r1-');
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({
    filo_onboarding: { done: true },
    sn_open_tabs: { tabs, colors: tabs.map(() => null), activeIndex: 0 },
  }));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' },
  });
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect(shell.locator('.tab')).toHaveCount(8, { timeout: 20_000 });
    await expect.poll(() => richieste.has('/p/0'), { timeout: 20_000 }).toBe(true);
    // La scheda in vista carica (6 s): le altre sette aspettano, e il server non le ha ancora viste.
    for (let i = 1; i < 8; i++) expect(richieste.has(`/p/${i}`)).toBe(false);
    await expect(shell.locator('.tab').first().locator('.spinner')).toHaveCount(1);
    await expect(shell.locator('.tab .spinner'), 'solo la scheda che carica davvero ha la rotella').toHaveCount(1);
  } finally {
    await chiudiApp(app).catch(() => {});
    await new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
    rmSync(dati, { recursive: true, force: true });
  }
});
