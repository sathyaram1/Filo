// Verifica #947 giro 3. r1: bollette della luce di mesi vicini il cui periodo è scritto in modi comuni che la ricerca
// non riconosce come periodo («dal 1 al 28 febbraio 2026», «01/02/2026-28/02/2026», le due date in colonna).

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';

const cartellaScaricamenti = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

function bolletta({ periodo, emessa, scadenza, lettura }) {
  return pdf([[
    'Servizio Elettrico Nazionale S.p.A. - Societa con socio unico',
    'Gentile Cliente MARIO ROSSI - VIA ROMA 12 - 20100 MILANO',
    `Bolletta n. 4100223344 del ${emessa}`,
    'Fornitura di energia elettrica - Servizio di Maggior Tutela',
    `Totale da pagare 68,10 euro entro il ${scadenza}`,
    `Quanto hai consumato: lettura rilevata il ${lettura}. Consumo fatturato 240 kWh`,
    `Periodo di fatturazione: ${periodo}`,
  ]]);
}

const FORMATI = {
  'dal 1 al 28 febbraio 2026': ['dal 1 al 28 febbraio 2026', 'dal 1 al 31 marzo 2026', 'dal 1 al 30 aprile 2026'],
  'date unite dal trattino': ['01/02/2026-28/02/2026', '01/03/2026-31/03/2026', '01/04/2026-30/04/2026'],
  'date in colonna': ['01/02/2026 28/02/2026', '01/03/2026 31/03/2026', '01/04/2026 30/04/2026'],
};

for (const [nome, [feb, mar, apr]] of Object.entries(FORMATI)) {
  test(`r1 periodo scritto «${nome}»: la bolletta di marzo è la prima e il testo per scegliere dice il periodo`, async ({ app }) => {
    test.setTimeout(90_000);
    const dir = join(await cartellaScaricamenti(app), `Bollette ${nome}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'scan_00198.pdf'), bolletta({ periodo: feb, emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }));
    writeFileSync(join(dir, 'scan_00231.pdf'), bolletta({ periodo: mar, emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }));
    writeFileSync(join(dir, 'scan_00250.pdf'), bolletta({ periodo: apr, emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }));
    try {
      const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('Mi serve la bolletta della luce di marzo. Dov\'è?'));
      const nomi = r.risultati.map((x) => x.nome);
      const visto = (n) => { const x = r.risultati.find((y) => y.nome === n) || {}; return `${x.inizio || ''} ${x.squarcio || ''}`; };
      expect(nomi[0], `ordine: ${nomi.join(', ')}`).toBe('scan_00231.pdf');
      expect(visto('scan_00231.pdf')).toContain(mar);
      expect(visto('scan_00198.pdf')).toContain(feb);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
