// Verifica #947 giro 3. r2: con le bollette di marzo di più anni, quella appena arrivata (la più recente) non passa
// davanti a quelle già nell'indice: a parità di punteggio vale l'ordine in cui l'indice le ha lette.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';

const cartellaScaricamenti = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

function bolletta(anno) {
  return pdf([[
    'Servizio Elettrico Nazionale S.p.A.',
    `Bolletta n. 4100223344 del 08/04/${anno}`,
    'Fornitura di energia elettrica - Servizio di Maggior Tutela',
    `Totale da pagare 68,10 euro entro il 28/04/${anno}. Consumo fatturato 240 kWh`,
    `Periodo di fatturazione: 01/03/${anno} - 31/03/${anno}`,
  ]]);
}

test('r2 la bolletta di marzo appena arrivata viene prima di quelle di marzo degli anni passati', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Bollette anni');
  mkdirSync(dir, { recursive: true });
  const scrivi = (nome, anno) => {
    const p = join(dir, nome);
    writeFileSync(p, bolletta(anno));
    const t = new Date(`${anno}-04-09T10:00:00Z`);
    utimesSync(p, t, t);
  };
  scrivi('scan_00104.pdf', 2024);
  scrivi('scan_00151.pdf', 2025);
  try {
    await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('bolletta luce marzo'));
    scrivi('scan_00231.pdf', 2026);
    const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('Mi serve la bolletta della luce di marzo. Dov\'è?'));
    const nomi = r.risultati.map((x) => x.nome);
    expect(nomi[0], `ordine: ${nomi.join(', ')}`).toBe('scan_00231.pdf');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
