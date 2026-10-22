// #1499, verifica giro 2: un documento trovato in una cartella di rete che l'utente stesso ha messo fra le cartelle dei
// documenti si trova, ma in chat non si può aprire. Su Linux «/net/<computer>» è la forma di rete della regola: la
// cartella si crea lì (serve poterla creare), su Windows la regola è un'altra e la prova non vale.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RADICE = '/net/nas-di-casa';

test('r1 un documento della cartella di rete scelta dall\'utente si trova e si apre dalla chat', async ({ app }) => {
  test.skip(process.platform === 'win32', 'su Windows la forma di rete è un\'altra');
  test.setTimeout(90_000);
  const creata = !existsSync('/net');
  try { mkdirSync(join(RADICE, 'Documenti'), { recursive: true }); } catch (_) { test.skip(true, 'non si può creare /net'); }
  const dir = join(RADICE, 'Documenti');
  const file = join(dir, 'bolletta_luce_marzo.txt');
  writeFileSync(file, 'Bolletta della luce, periodo marzo 2026, totale da pagare 84,20 euro');
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__aperti = [];
      shell.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    });
    await app.evaluate(async (_e, d) => {
      await globalThis.SN_STORAGE.updateSettings({ documenti: { cartelle: [d] } });
    }, dir);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'bolletta luce marzo' }) }] },
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file, etichetta: 'Bolletta della luce di marzo' }) }] },
      { text: 'Ecco la bolletta della luce di marzo.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'mi serve la bolletta della luce di marzo');
    // La ricerca la trova: il modello ha il file fra i risultati.
    await expect.poll(async () => JSON.stringify((await chiamateAlModello(app))[1] || ''), { timeout: 20_000 }).toContain('bolletta_luce_marzo.txt');
    // E l'utente lo deve poter aprire.
    const btn = page.locator('.dash-file-btn');
    await expect(btn).toHaveCount(1, { timeout: 20_000 });
    await btn.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([file]);
  } finally {
    await ripristina(app);
    rmSync(creata ? '/net' : RADICE, { recursive: true, force: true });
  }
});
