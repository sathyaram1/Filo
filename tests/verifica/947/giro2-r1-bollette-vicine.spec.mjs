// Verifica #947 giro 2. r1: bollette della luce di mesi vicini, fatte come quelle vere (emesse e in scadenza il mese
// dopo il periodo). La porta del giro 1 sul documento appena arrivato si ri-prova senza numero.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';

const cartellaScaricamenti = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

function bolletta({ periodo, emessa, scadenza, lettura }) {
  return pdf([[
    'Servizio Elettrico Nazionale S.p.A. - Società con socio unico',
    'Sede legale Viale Regina Margherita 125 00198 Roma - Partita IVA 09633951000',
    'Gentile Cliente MARIO ROSSI - VIA ROMA 12 - 20100 MILANO',
    `Bolletta n. 4100223344 del ${emessa}`,
    'Fornitura di energia elettrica - Servizio di Maggior Tutela',
    'Codice cliente 123456789 - POD IT001E12345678 - Potenza impegnata 3 kW',
    `Totale da pagare 68,10 euro entro il ${scadenza}`,
    'Il pagamento si fa con domiciliazione bancaria, bollettino postale o carta di credito.',
    `Quanto hai consumato: lettura rilevata il ${lettura}. Consumo fatturato 240 kWh`,
    'Spesa per la materia energia 40,10 euro; trasporto e gestione del contatore 15,00 euro',
    `Periodo di fatturazione: ${periodo}`,
  ]]);
}

test('r1 fra le bollette della luce di mesi vicini, quella di marzo è la prima e il testo per scegliere dice il periodo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Bollette');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scan_00198.pdf'), bolletta({ periodo: '01/02/2026 - 28/02/2026', emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }));
  writeFileSync(join(dir, 'scan_00231.pdf'), bolletta({ periodo: '01/03/2026 - 31/03/2026', emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }));
  writeFileSync(join(dir, 'scan_00250.pdf'), bolletta({ periodo: '01/04/2026 - 30/04/2026', emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }));
  try {
    const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('Mi serve la bolletta della luce di marzo. Dov\'è?'));
    const nomi = r.risultati.map((x) => x.nome);
    // Quello che il modello vede di ogni candidato per scegliere.
    const visto = (nome) => { const x = r.risultati.find((y) => y.nome === nome) || {}; return `${x.inizio || ''} ${x.squarcio || ''}`; };
    expect(nomi[0], `ordine: ${nomi.join(', ')}`).toBe('scan_00231.pdf');
    expect(visto('scan_00231.pdf')).toContain('01/03/2026 - 31/03/2026');
    expect(visto('scan_00198.pdf')).toContain('01/02/2026 - 28/02/2026');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un documento messo nella cartella subito dopo una ricerca si trova alla ricerca dopo', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(await cartellaScaricamenti(app), 'Arrivi');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'appunti.txt'), 'lista della spesa');
  try {
    const prima = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('contratto di locazione'));
    expect(prima.risultati.length).toBe(0);
    writeFileSync(join(dir, 'doc_77.txt'), 'Contratto di locazione ad uso abitativo, Via Roma 12');
    const dopo = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('contratto di locazione'));
    expect(dopo.risultati.map((x) => x.nome)).toContain('doc_77.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
