// Verifica #949 giro 7, rilievo 1: un nome che indica una lista di siti fidati non deve finire nell'altra.
// «siti fidati per i download» parla dei programmi scaricati: non deve aggiungere il sito ai fidati dei cookie.
import { test, expect } from '../../fixtures/electron.mjs';

test('«siti fidati per i download» non cambia l\'elenco dei siti dove resti connesso', async ({ app }) => {
  const r = await app.evaluate(() => {
    const P = globalThis.SN_PREF;
    return ['siti fidati per i download', 'siti fidati per gli eseguibili'].map((k) => {
      const b = P.buildPreferencePartial(k, 'aggiungi a.it');
      return { k, percorso: b && b.elenco ? b.elenco.percorso : null, rifiuto: !!(b && b.rifiuto) };
    });
  });
  for (const x of r) {
    expect(x.percorso === 'security.cookies.trustedSites', `${x.k} → ${x.percorso}`).toBe(false);
  }
});
