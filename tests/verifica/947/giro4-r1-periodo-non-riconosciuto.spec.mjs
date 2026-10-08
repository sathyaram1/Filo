// Verifica #947 giro 4. r1: quando il periodo di una bolletta è scritto in un modo che la ricerca non riconosce
// («dal 1° al 28 febbraio 2026», «febbraio-2026»), la data di emissione «Bolletta n. … del 06/03/2026» conta ancora come
// indizio di marzo: febbraio pareggia con marzo e decide la data del file; il testo per scegliere non dice il periodo.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
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
  'dal 1° al 31 marzo 2026': ['dal 1° al 28 febbraio 2026', 'dal 1° al 31 marzo 2026', 'dal 1° al 30 aprile 2026'],
  'marzo-2026': ['febbraio-2026', 'marzo-2026', 'aprile-2026'],
};

for (const [nome, [feb, mar, apr]] of Object.entries(FORMATI)) {
  test(`r1 periodo scritto «${nome}», bollette scansionate lo stesso giorno: marzo è la prima e il testo per scegliere dice il periodo`, async ({ app }) => {
    test.setTimeout(90_000);
    const dir = join(await cartellaScaricamenti(app), `Bollette ${nome}`);
    mkdirSync(dir, { recursive: true });
    const scrivi = (n, b) => {
      const p = join(dir, n);
      writeFileSync(p, b);
      const t = new Date('2026-06-10T10:00:00Z');
      utimesSync(p, t, t);
    };
    scrivi('scan_00231.pdf', bolletta({ periodo: mar, emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }));
    scrivi('scan_00198.pdf', bolletta({ periodo: feb, emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }));
    scrivi('scan_00250.pdf', bolletta({ periodo: apr, emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }));
    try {
      const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('Mi serve la bolletta della luce di marzo. Dov\'è?'));
      const nomi = r.risultati.map((x) => x.nome);
      const visto = (n) => { const x = r.risultati.find((y) => y.nome === n) || {}; return `${x.inizio || ''} ${x.squarcio || ''}`; };
      expect(nomi[0], `ordine: ${nomi.join(', ')}`).toBe('scan_00231.pdf');
      expect(visto('scan_00231.pdf')).toContain(mar);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('r1 un mese con l\'anno scritto fuori dal periodo («prossima lettura prevista a marzo 2026») non fa della bolletta di febbraio una bolletta di marzo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Bollette prossima lettura');
  mkdirSync(dir, { recursive: true });
  const scrivi = (n, b) => {
    const p = join(dir, n);
    writeFileSync(p, b);
    const t = new Date('2026-06-10T10:00:00Z');
    utimesSync(p, t, t);
  };
  const conProssima = (o, prossima) => pdf([[
    'Servizio Elettrico Nazionale S.p.A.',
    `Bolletta n. 4100223344 del ${o.emessa}`,
    'Fornitura di energia elettrica - Servizio di Maggior Tutela',
    `Totale da pagare 68,10 euro entro il ${o.scadenza}`,
    `Periodo di fatturazione: ${o.periodo}`,
    `Prossima lettura prevista a ${prossima}`,
  ]]);
  scrivi('scan_00231.pdf', conProssima({ periodo: '01/03/2026 - 31/03/2026', emessa: '08/04/2026', scadenza: '28/04/2026' }, 'aprile 2026'));
  scrivi('scan_00198.pdf', conProssima({ periodo: '01/02/2026 - 28/02/2026', emessa: '06/03/2026', scadenza: '26/03/2026' }, 'marzo 2026'));
  try {
    const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('Mi serve la bolletta della luce di marzo. Dov\'è?'));
    const nomi = r.risultati.map((x) => x.nome);
    expect(nomi[0], `ordine: ${nomi.join(', ')}`).toBe('scan_00231.pdf');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
