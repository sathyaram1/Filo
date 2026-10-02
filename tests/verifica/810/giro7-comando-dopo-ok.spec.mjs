// Verifica #810, giro 7: la porta del giro 6 sul comando, ri-provata. Un comando dettato dall'utente col
// suo codice, di quelli che chiedono l'OK, parte dopo l'OK anche se Filo aveva letto lo stesso codice.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CODICE, preparaModelli, modelloFinto, newtab, senzaAccoglienza, LEGGI_CODICE } from './aiuti.mjs';

test('dopo l’OK un comando dettato dall’utente col suo codice parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const casa = cartellaInCasa('filo-g7-');
  const file = join(casa, `nota-${CODICE}.txt`);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtab(app);
    await preparaModelli(app);
    await senzaAccoglienza(app, page);
    await modelloFinto(app, { giri: [LEGGI_CODICE, { text: 'La banca ti ha mandato un codice monouso.' }] });
    await page.locator('#input').fill('leggi la notifica della banca');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'La banca ti ha mandato' })).toBeVisible({ timeout: 20_000 });
    await modelloFinto(app, {
      giri: [
        { toolCalls: [{ id: 't1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `touch "${file}"` }) }] },
        { text: 'Creato.' },
      ],
    });
    await page.locator('#input').fill(`crea il file nota-${CODICE}.txt nella cartella ${casa}`);
    await page.locator('#sendBtn').click();
    await page.locator('.dash-action-btn', { hasText: 'touch' }).last().click({ timeout: 15_000 });
    await clickConfirm(page, 'ok', { timeout: 8_000 });
    await expect.poll(() => existsSync(file), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('.dash-activity-row', { hasText: 'Non ho eseguito' })).toHaveCount(0);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
