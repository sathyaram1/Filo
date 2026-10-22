import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const testo = (ms) => (ms || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app }) => {
    test.setTimeout(90_000);
    const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Vero');
    mkdirSync(dir, { recursive: true });
    const vero = join(dir, 'scan_00231.pdf');
    writeFileSync(vero, '%PDF-1.4');
    const lungo = join(dir, 'Estratto_conto_corrente_ordinario_secondo_trimestre_2026_banca_versione_definitiva.pdf');
    writeFileSync(lungo, '%PDF-1.4');
    try {
      await modelloFinto(app, [
        { toolCalls: [
          { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta: 'Bolletta della luce di marzo' }) },
          { id: 'f2', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero }) },
          { id: 'f3', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: lungo, etichetta: 'Estratto conto della banca del secondo trimestre, quello definitivo inviato a giugno' }) },
        ] },
        { text: 'Ecco.' },
      ]);
      const page = await home(app);
      await page.emulateMedia({ colorScheme: tema });
      await chiedi(page, 'trovami la bolletta');
      await expect(page.locator('.dash-file-btn')).toHaveCount(3, { timeout: 20_000 });
      await page.screenshot({ path: `tests/.shots/v1499-aspetto-${tema}.png` });
      await page.locator('.dash-file-btn').first().hover();
      await page.screenshot({ path: `tests/.shots/v1499-hover-${tema}.png` });
    } finally {
      await ripristina(app);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const cartella of ['«/etc', '"/', "'/var/log", '«~/../..']) {
  test(`ricerca in ${cartella} chiede l'OK`, async ({ app }) => {
    test.setTimeout(90_000);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'password', cartella }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'cerca');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `tests/.shots/v1499-ok-${cartella.replace(/[^a-z]/gi, '_')}.png` });
    const calls = await chiamateAlModello(app);
    const t = testo(calls[1]);
    console.log('ESITO', cartella, t.slice(-600));
    expect(t).not.toMatch(/risultati":\s*\[\s*\{/);
    await ripristina(app);
  });
}
