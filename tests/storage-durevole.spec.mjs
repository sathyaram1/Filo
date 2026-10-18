// Il file dei dati rovinato da una chiusura a metà scrittura (#1087): alla riapertura le schede tornano dalla copia
// di riserva, il file rovinato resta accanto e un avviso nella cornice dice cosa è successo.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

async function finestra(app, prova, timeout = 20_000) {
  const scadenza = Date.now() + timeout;
  while (Date.now() < scadenza) {
    const w = app.windows().find((p) => { try { return prova(p.url()); } catch (_) { return false; } });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test('storage.json troncato: le schede tornano dalla copia di riserva, il rovinato resta e l\'avviso lo dice', async ({ testServer }) => {
  const url = testServer.html('<title>Scheda di ieri</title><body><h1>ancora qui</h1></body>');
  const host = new URL(url).hostname;
  const dati = cartellaTemporanea('filo-durevole-');
  const sano = JSON.stringify({ sn_open_tabs: { tabs: [url], colors: [null], activeIndex: 0 }, sn_nota_prova: 'da non perdere' });
  const troncato = sano.slice(0, Math.floor(sano.length / 2));
  writeFileSync(join(dati, 'storage.json'), troncato);
  writeFileSync(join(dati, 'storage.json.bak'), sano);

  let app;
  try {
    app = await electron.launch({
      args: [...argomentiScala, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' },
    });
    const scheda = await finestra(app, (u) => new URL(u).hostname === host);
    expect(scheda, 'la scheda salvata prima del guasto si riapre').toBeTruthy();
    await expect(scheda.locator('h1')).toHaveText('ancora qui');

    const vista = await finestra(app, (u) => u.startsWith('filo://shell/avvisi.html'));
    expect(vista, 'la vista degli avvisi nasce').toBeTruthy();
    const carta = vista.locator('.shell-notif.show', { hasText: 'copia di riserva' });
    await expect(carta).toBeVisible({ timeout: 15_000 });
    const rovinato = readdirSync(dati).find((n) => n.startsWith('storage.json.rovinato-'));
    expect(rovinato).toBeTruthy();
    await expect(carta.locator('.shell-notif-msg')).toContainText(rovinato);
    expect(readFileSync(join(dati, rovinato), 'utf8')).toBe(troncato);
    mkdirSync(SHOTS, { recursive: true });
    await vista.screenshot({ path: join(SHOTS, 'storage-durevole-avviso.png') });

    await carta.locator('.shell-notif-close').click();
    await expect(carta).toBeHidden();

    await chiudiApp(app);
    app = null;
    const salvato = JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8'));
    expect(salvato.sn_nota_prova).toBe('da non perdere');
    expect(salvato.sn_open_tabs.tabs).toContain(url);
  } finally {
    if (app) await chiudiApp(app).catch(() => {});
    rmSync(dati, { recursive: true, force: true });
  }
});
