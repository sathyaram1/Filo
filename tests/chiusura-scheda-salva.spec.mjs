// Le pagine che salvano da sole aspettano un attimo: uscire dentro quell'attimo
// buttava via l'ultima modifica, perché una scheda distrutta non riceve
// `pagehide`. La cura è in src/main/congedo.js; qui si guarda dal lato utente.

import { _electron as electron } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function schede(shell) {
  return shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    return lista.map((t) => ({ id: t.id, url: t.url || '' }));
  });
}

async function chiudiLaScheda(shell, frammento) {
  const aperte = await schede(shell);
  const scheda = aperte.find((t) => t.url.includes(frammento));
  expect(scheda, `scheda «${frammento}» non trovata fra quelle aperte`).toBeTruthy();
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
}

test('Preferenze: quello che scrivi resta anche se chiudi subito la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  const atteso = 'stile scritto un attimo prima di chiudere';
  await page.evaluate((t) => {
    const el = document.getElementById('agentStyleText');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, atteso);

  await chiudiLaScheda(shell, 'preferences');

  await expect
    .poll(async () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).agentStyle || ''),
      { timeout: 8000, message: 'chiudendo la scheda l\'ultima modifica si perde' })
    .toBe(atteso);
});

test('Opzioni: quello che scrivi resta anche se chiudi subito la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.evaluate(() => {
    const el = document.getElementById('monthlyLimit');
    el.value = '23';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await chiudiLaScheda(shell, 'options');

  await expect
    .poll(async () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).monthlyLimitEur),
      { timeout: 8000, message: 'chiudendo la scheda l\'ultima modifica si perde' })
    .toBe(23);
});

// Terza uscita, e la più comune a fine giornata: si scrive e si spegne Filo.
// Serve una cartella dati che sopravviva alla chiusura, quindi qui l'app si
// apre a mano invece di usare quella della fixture.
async function scriviESpegni(pagina, scrivi, campo) {
  const userData = cartellaTemporanea('filo-test-uscita-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: RADICE,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
    const nome = new URL(pagina).hostname;
    const scadenza = Date.now() + 15_000;
    let page = null;
    while (Date.now() < scadenza) {
      page = app.windows().find((w) => w.url().includes(nome));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(page, `la scheda ${nome} non si è aperta`).toBeTruthy();
    await scrivi(page);
  } finally {
    // Nessuna attesa: si spegne dentro l'attimo in cui il salvataggio aspetta.
    await chiudiApp(app);
  }
  let salvato = '';
  try {
    const dati = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    const s = dati.settings || dati;
    salvato = s && s[campo] != null ? String(s[campo]) : '';
  } catch (e) {
    salvato = `[storage illeggibile: ${e.message}]`;
  }
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  return salvato;
}

test('Preferenze: quello che scrivi resta anche se spegni subito Filo', async () => {
  test.setTimeout(120_000);
  const atteso = 'stile scritto un attimo prima di spegnere';
  const salvato = await scriviESpegni('filo://preferences/preferences.html', async (page) => {
    await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
    await page.evaluate((t) => {
      const el = document.getElementById('agentStyleText');
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, atteso);
  }, 'agentStyle');
  expect(salvato, 'spegnendo Filo l\'ultima modifica si perde').toBe(atteso);
});

test('Opzioni: quello che scrivi resta anche se spegni subito Filo', async () => {
  test.setTimeout(120_000);
  const salvato = await scriviESpegni('filo://options/options.html', async (page) => {
    await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
    await page.evaluate(() => {
      const el = document.getElementById('monthlyLimit');
      el.value = '31';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, 'monthlyLimitEur');
  expect(salvato, 'spegnendo Filo l\'ultima modifica si perde').toBe('31');
});
