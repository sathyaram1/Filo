// Esplorazione: «dimentica» semplice a Conservativo dopo una lettura chiede l'OK in chat, e con l'OK nasconde la riga.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('Conservativo, dopo un documento letto: «dimentica» chiede, e con l\'OK la riga va fra le nascoste', async ({ app }) => {
  const casa = cartellaInCasa('filo-553-5-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'ciao\n', 'utf8');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
    await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Bologna.\nHa un gatto.', PREFERENZE: '' }));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: doc }) }] },
      { text: 'Letto.' },
      { toolCalls: [{ id: 'f1', name: 'DIMENTICA', arguments: JSON.stringify({ testo: 'Bologna' }) }] },
      { text: 'Fine.' },
    ]);
    await chiedi(page, 'leggimi note.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letto.' })).toBeVisible({ timeout: 15000 });
    await chiedi(page, 'dimentica che vivo a Bologna');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
    const testo = await confirmText(page);
    expect(testo).toContain('Vive a Bologna.');
    await clickConfirm(page, 'ok');
    await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.quaderno()).nascoste.map((n) => n.testo)), { timeout: 8000 })
      .toEqual(['Vive a Bologna.']);
    const mem = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()));
    expect(mem).not.toContain('Bologna');
    expect(mem).toContain('gatto');
  } finally {
    await ripristina(app);
    rmSync(casa, { recursive: true, force: true });
  }
});
