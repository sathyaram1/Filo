import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { apriCronologia, statoCronologia } from './helpers/cronologiaAppunti.mjs';

// Feedback alpha: "lo scroll non funziona — quando uso la rotella si chiude il
// box invece di mostrare gli appunti più vecchi". La cronologia incolla è
// scorrevole, ma il listener di chiusura del menu era in capture su `scroll`
// (window) e intercettava anche lo scroll INTERNO della lista, chiudendo tutto.
//
// Questo test asserisce il comportamento corretto: girare la rotella sulla
// lista la fa scorrere (scrollTop aumenta) e il menu RESTA aperto.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('rotella sulla cronologia incolla: scorre e NON chiude il menu', async ({ testServer }) => {
  const history = [];
  for (let i = 1; i <= 30; i++) {
    history.push({ type: 'text', text: `appunto numero ${i}`, ts: Date.now() - i });
  }
  const userData = cartellaTemporanea('filo-scroll-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page).toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    const stato = await apriCronologia(app, page, '#ta');

    // "compare separato dal box principale": la cronologia deve apparire
    // ATTACCATA al menu, non come un riquadro fluttuante staccato. Il bordo
    // sinistro del sotto-menu deve combaciare col bordo destro del menu padre.
    const m = await page.locator('.sn-menu:not(.sn-menu-sub)').boundingBox();
    const gap = Math.abs(stato.riquadro.left - (m.x + m.width));
    expect(gap, 'il sotto-menu deve toccare il box principale').toBeLessThanOrEqual(6);
    expect(stato.voci[0]?.testo).toBe('appunto numero 1');

    // La lista deve essere scorrevole (30 voci eccedono l'altezza massima).
    const { lista } = stato;
    expect(lista.scrollHeight > lista.clientHeight + 4, 'la lista deve essere scorrevole').toBe(true);

    // Rotella sopra la lista: deve scorrere, non chiudere.
    await page.mouse.move(lista.centro.x, lista.centro.y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);

    // Il menu è ANCORA aperto (prima del fix qui veniva chiuso).
    await expect(page.locator('.sn-menu:not(.sn-menu-sub)')).toBeVisible();
    const dopo = await statoCronologia(app, page);
    expect(dopo, 'la cronologia resta aperta').not.toBeNull();

    // E lo scroll ha effettivamente spostato la lista verso le voci più vecchie.
    expect(dopo.lista.scrollTop, 'la rotella deve scorrere la lista').toBeGreaterThan(lista.scrollTop);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
