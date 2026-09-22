// Le pagine di Filo che salvano da sole aspettano un attimo prima di scrivere.
// Chiudere la scheda dentro quell'attimo buttava via l'ultima modifica: una
// scheda distrutta non riceve `pagehide`, quindi il salvataggio non partiva mai.
// La cura sta in src/main/congedo.js; qui si guarda l'esito dal lato utente.

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
