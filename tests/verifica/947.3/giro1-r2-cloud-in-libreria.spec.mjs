// Verifica #947.3 giro 1: su Mac iCloud Drive e le cartelle di Dropbox, OneDrive e Google Drive stanno dentro la
// Libreria (Mobile Documents, CloudStorage): «cerca in tutta la mia cartella» deve trovarci i documenti dell'utente.
// Riprodotto con una cartella personale di prova, come la prova della Libreria.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r2 cercando in tutta la cartella personale si trovano i documenti di iCloud Drive e delle cartelle cloud', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = cartellaTemporanea('filo-casa-mac-');
  const icloud = join(casa, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Bollette');
  const dropbox = join(casa, 'Library', 'CloudStorage', 'Dropbox', 'Contratti');
  const posta = join(casa, 'Library', 'Mail');
  for (const d of [icloud, dropbox, posta]) mkdirSync(d, { recursive: true });
  writeFileSync(join(icloud, 'luce-marzo.txt'), 'Bolletta energia elettrica, periodo marzo 2026, totale 61 euro');
  writeFileSync(join(dropbox, 'affitto.txt'), 'Contratto di locazione ad uso abitativo, canone mensile 650 euro');
  mkdirSync(join(casa, 'Lavori'), { recursive: true });
  writeFileSync(join(casa, 'Lavori', 'luce-aprile.txt'), 'Bolletta energia elettrica, periodo aprile 2026');
  writeFileSync(join(posta, 'allegato.txt'), 'Bolletta energia elettrica allegata a una mail');
  try {
    const nomi = await app.evaluate(async (_e, casa) => {
      const I = globalThis.SN_DOCUMENTI_INDICE;
      I.configura({ casa: () => casa });
      const luce = await I.cerca('bolletta luce marzo', { cartella: casa });
      const affitto = await I.cerca('contratto affitto', { cartella: casa });
      return { luce: luce.risultati.map((x) => x.nome), affitto: affitto.risultati.map((x) => x.nome) };
    }, casa);
    expect(nomi.luce, 'la ricerca nella cartella personale funziona').toContain('luce-aprile.txt');
    expect(nomi.luce, 'la bolletta in iCloud Drive').toContain('luce-marzo.txt');
    expect(nomi.affitto, 'il contratto in Dropbox').toContain('affitto.txt');
    expect(nomi.luce, 'la posta resta fuori').not.toContain('allegato.txt');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
