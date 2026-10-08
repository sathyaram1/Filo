// r2 — una cartella chiesta per l'occasione, fuori dall'elenco: la ricerca dopo la svuota dall'indice, e chiederla di
// nuovo rilegge da capo ogni suo documento.
import { test, expect } from '../../fixtures/electron.mjs';
import { join, dirname } from 'node:path';
import { rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { cartellaDellaProva } from '../../helpers/documentiFinti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

// Ogni documento letto lascia una riga col suo testo nell'indice su disco.
function lettiDa(file, cartella) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter((r) => r.includes('"n":') && r.includes(JSON.stringify(cartella).slice(1, -1))).length;
}

test('r2 la seconda ricerca nella stessa cartella fuori elenco non rilegge i documenti già letti', async ({ app }) => {
  test.setTimeout(90_000);
  const archivio = cartellaTemporanea('filo-archivio-');
  cartellaDellaProva(archivio);
  // Nelle cartelle dell'elenco c'è almeno un documento, come su ogni computer vero.
  const scaricato = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'appunti-r2.txt');
  mkdirSync(dirname(scaricato), { recursive: true });
  writeFileSync(scaricato, 'appunti sparsi');
  const indice = join(await app.evaluate(() => process.env.FILO_USER_DATA), 'documenti', 'indice.jsonl');
  try {
    const cerca = (cosa, cartella) => app.evaluate(async (_e, a) => {
      const r = await globalThis.SN_DOCUMENTI_INDICE.cerca(a.cosa, a.cartella ? { cartella: a.cartella } : {});
      return r.risultati[0] && r.risultati[0].nome;
    }, { cosa, cartella });
    expect(await cerca('bolletta luce marzo', archivio)).toBe('scan_00231.pdf');
    const dopoLaPrima = lettiDa(indice, archivio);
    expect(dopoLaPrima).toBeGreaterThanOrEqual(20);
    await cerca('contratto affitto', '');
    expect(await cerca('contratto affitto locazione', archivio)).toBe('documento (3).docx');
    expect(lettiDa(indice, archivio) - dopoLaPrima, 'i documenti dell\'archivio non sono cambiati: niente da rileggere').toBe(0);
  } finally {
    rmSync(archivio, { recursive: true, force: true });
    rmSync(scaricato, { force: true });
  }
});
