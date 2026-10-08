// Verifica #947 giro 7. r2: una ricerca chiesta mentre l'indice sta già leggendo (il primo giro dopo l'avvio, o un
// lotto di file nuovi) si accoda a quel giro, che ha elencato le cartelle prima che il file arrivasse: la bolletta
// salvata un attimo prima di chiedere non si trova.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r2 la bolletta salvata mentre l\'indice sta leggendo altri file si trova alla ricerca chiesta subito dopo', async ({ app }) => {
  test.setTimeout(120_000);
  const doc = cartellaTemporanea('filo-947-g7-');
  for (let i = 0; i < 40; i++) writeFileSync(join(doc, `vecchio_${String(i).padStart(3, '0')}.txt`), `appunti numero ${i}`);
  await app.evaluate((_e, d) => {
    process.env.FILO_DOCUMENTI_DIR = d;
    const I = globalThis.SN_DOCUMENTI_INDICE;
    I._azzera();
    // Un lettore lento come su una cartella vera piena di PDF; la bolletta ha il suo testo.
    I.configura({
      impostazioni: async () => ({ documenti: { cartelle: ['documenti'] } }),
      estrai: async (p) => {
        await new Promise((ok) => setTimeout(ok, 150));
        const testo = /scan_00777/.test(p)
          ? 'Bolletta per la fornitura di energia elettrica\nPeriodo di fatturazione: 01/03/2026 - 31/03/2026\nConsumo 212 kWh'
          : `appunti ${p}`;
        return { testo, pagine: 1, vuoto: false, errore: '' };
      },
    });
    // Il giro in sottofondo (quello dopo l'avvio, o quello ogni mezz'ora) parte prima che l'utente chieda.
    I.aggiorna();
  }, doc);
  try {
    await expect.poll(async () => (await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.stato())).inCorso, { timeout: 10_000 })
      .not.toBeNull();
    // L'utente salva la bolletta dalla posta e la chiede subito.
    writeFileSync(join(doc, 'scan_00777.txt'), 'bolletta');
    const r = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('mi serve la bolletta della luce di marzo'));
    const dopo = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('mi serve la bolletta della luce di marzo'));
    expect(r.risultati.map((x) => x.nome), `chiedendo una seconda volta: ${dopo.risultati.map((x) => x.nome).join(', ')}`).toContain('scan_00777.txt');
  } finally {
    rmSync(doc, { recursive: true, force: true });
  }
});
