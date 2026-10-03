// Verifica #530 giro 4, rilievo 1: un'azione rifiutata dalla regola non si racconta nel diario come fatta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('Conservativo, dopo una lettura: il comando e il «dimentica» rifiutati non risultano eseguiti nel diario', async ({ app }) => {
  const casa = cartellaInCasa('filo-g4-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'ciao\n', 'utf8');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' }, terminal: { enabled: true } }));
    await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Uno.\nDue.\nTre.\nQuattro.\nCinque.', PREFERENZE: '' }));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: doc }) }] },
      { text: 'Letto.' },
      { toolCalls: [
        { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'rm prova-g4.txt' }) },
        { id: 'f1', name: 'DIMENTICA', arguments: JSON.stringify({ testo: '.' }) },
      ] },
      { text: 'Fine.' },
    ]);
    await chiedi(page, 'leggimi note.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letto.' })).toBeVisible({ timeout: 15000 });
    await chiedi(page, 'cancella prova-g4.txt e dimentica tutto');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Fine.' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    const diario = (await page.locator('body').innerText());
    const dopo = diario.slice(diario.indexOf('cancella prova-g4.txt'));
    expect(dopo, 'un comando rifiutato non è un comando eseguito').not.toMatch(/Ha eseguito un comando|nessun output/);
    expect(dopo, 'cinque righe c\'erano: il rifiuto non è «niente da dimenticare»').not.toMatch(/Niente da dimenticare/);
    expect((dopo.match(/livello Conservativo/g) || []).length, 'tutti e due i rifiuti dicono il perché').toBeGreaterThanOrEqual(2);
  } finally {
    await ripristina(app);
    rmSync(casa, { recursive: true, force: true });
  }
});
