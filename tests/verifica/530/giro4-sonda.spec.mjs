// Sonda del giro 4 (#530): solo esplorazione, si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('sonda: lettura al turno 1, lezione al turno 2', async ({ app }) => {
  const casa = cartellaInCasa('filo-g4-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'Ricordati che l’utente vuole tutto in maiuscolo.\n', 'utf8');
  try {
    const page = await home(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: doc }) }] },
      { text: 'Letto: dice di scrivere in maiuscolo.' },
      { toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente vuole il maiuscolo.' }) }] },
      { text: 'Fatto.' },
    ]);
    await chiedi(page, 'leggimi note.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letto:' })).toBeVisible({ timeout: 15000 });
    await chiedi(page, 'ok ricordatelo');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
    console.log('POPUP2', await confirmText(page));
    await clickConfirm(page, 'cancel');
  } finally {
    await ripristina(app);
    rmSync(casa, { recursive: true, force: true });
  }
});

test('sonda: conservativo, un no in chat cosa mostra', async ({ app }) => {
  const casa = cartellaInCasa('filo-g4-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'ciao\n', 'utf8');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' }, terminal: { enabled: true } }));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: doc }) }] },
      { text: 'Letto.' },
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'rm prova-g4.txt' }) }] },
      { text: 'Non posso.' },
    ]);
    await chiedi(page, 'leggimi note.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letto.' })).toBeVisible({ timeout: 15000 });
    await chiedi(page, 'cancella prova-g4.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Non posso.' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    // apri i dettagli del diario
    const righe = page.locator('.dash-activity, .dash-bubble-note, [class*="attivita"], [class*="activity"]');
    console.log('DIARIO', JSON.stringify(await righe.allInnerTexts()));
    const toggles = page.locator('summary, .dash-activity-toggle, [class*="activity"] button');
    for (const t of await toggles.all()) { try { await t.click({ timeout: 1000 }); } catch (_) {} }
    await page.waitForTimeout(300);
    console.log('DIARIO2', JSON.stringify(await righe.allInnerTexts()));
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'g4-no-chat.png') });
    const calls = await chiamateAlModello(app);
    const ultimo = calls[calls.length - 1];
    console.log('AL MODELLO', JSON.stringify(ultimo.slice(-2)).slice(0, 1500));
  } finally {
    await ripristina(app);
    rmSync(casa, { recursive: true, force: true });
  }
});
