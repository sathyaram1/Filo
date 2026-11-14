// Verifica #1564 giro 3, rilievo 1: dentro uno strumento il modello copia il nome dell'azione accanto (percorso di
// file(leggi), chiave di impostazioni(imposta)); chi esegue lo accetta, il controllo dei campi obbligatori no.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('r1 «cancella il file» con file(elimina) e percorso, come in file(leggi): arriva la conferma del cestino', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-r1-');
  const nome = `vecchia bolletta ${Date.now()}.pdf`;
  const file = join(dir, nome);
  writeFileSync(file, '%PDF-1.4 bolletta');
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'e1', name: 'file', arguments: JSON.stringify({ azione: 'elimina', percorso: file }) }] },
      { text: 'Non ci sono riuscito.' },
    ]);
    await chiedi(page, `cancella il file ${nome}`);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
    expect((await confirmState(page)).text).toContain(nome);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r1 «accento rosso» con impostazioni(aspetto) e chiave, come in impostazioni(imposta): l\'accento cambia', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'a1', name: 'impostazioni', arguments: JSON.stringify({ azione: 'aspetto', chiave: 'accent', valore: '#c0392b' }) }] },
      { text: 'Non ci sono riuscito.' },
    ]);
    await chiedi(page, 'metti l\'accento rosso');
    await expect.poll(() => app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      return (s.themeTokens || {}).accent || '';
    }), { timeout: 15_000 }).toBe('#c0392b');
  } finally {
    await ripristina(app);
  }
});
