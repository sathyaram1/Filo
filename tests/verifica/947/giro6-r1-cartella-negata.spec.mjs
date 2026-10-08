// #947 giro 6: su Mac la prima ricerca fa comparire la richiesta del sistema per Documenti, Scrivania e Download. Chi
// risponde «Non consentire» ha una cartella che Filo non può elencare: la ricerca la conta come vuota, il modello sente
// «0 documenti in Documenti» e risponde che la bolletta non c'è. Qui il rifiuto del sistema si imita sull'elenco della
// cartella (EPERM, com'è su macOS): il modello deve sapere che la cartella non si è potuta leggere, e perché.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaDellaProva } from '../../helpers/documentiFinti.mjs';

test('r1 una cartella che il sistema non lascia leggere non passa per vuota: il modello sa che manca il permesso', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Negata');
  cartellaDellaProva(dir);
  try {
    await app.evaluate((_e, negata) => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const path = process.getBuiltinModule('node:path');
      globalThis.__readdirVero = fsp.readdir;
      fsp.readdir = async (d, o) => {
        if (path.resolve(String(d)) === path.resolve(negata)) {
          const e = new Error(`EPERM: operation not permitted, scandir '${d}'`);
          e.code = 'EPERM';
          throw e;
        }
        return globalThis.__readdirVero(d, o);
      };
    }, await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'bolletta luce energia elettrica kWh marzo' }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'mi serve la bolletta della luce di marzo');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    const esito = (await chiamateAlModello(app))[1]
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    // Il blocco che la ricerca rimette al modello: dalla sua prima riga alla fine del messaggio che lo contiene.
    const i = Math.max(esito.lastIndexOf('[Nessun documento combacia'), esito.lastIndexOf('[Ricerca fra i documenti'));
    expect(i, 'il blocco della ricerca arriva al modello').toBeGreaterThanOrEqual(0);
    const blocco = esito.slice(i, i + 3000);
    expect(blocco, 'il modello sente che Download non si è potuta leggere per un permesso del sistema')
      .toMatch(/permess|accesso negato|non (?:posso|riesco a|ho potuto|si è potuta|si può) (?:leggere|aprire|elencare)/i);
  } finally {
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      if (globalThis.__readdirVero) fsp.readdir = globalThis.__readdirVero;
    });
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
