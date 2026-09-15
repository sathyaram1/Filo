// #584, ottavo giro — la cosa chiesta, e il bordo del nome del sito.
//
// Prima metà: la richiesta del feedback, provata dal capo dell'utente. La
// lettura dei percorsi condivisi passa da una strada che NOMINA un sito e non
// espone la raccolta intera; l'assistente di pagina ritrova i percorsi riusciti
// di quel sito nel proprio messaggio di sistema.
//
// Seconda metà: la lista dei «siti che non sono di nessuno» del settimo giro,
// e il pezzo di bordo che le resta fuori — un nome di host più lungo del
// massimo viene TAGLIATO prima del controllo, e col taglio se ne va il
// suffisso su cui il controllo si basa. Serve un nome di oltre 253 caratteri,
// quindi non lo vedrà nessuno: la prova (marcata RILIEVO) sta qui perché il
// caso è vero e la correzione è una riga.

import { test, expect } from '../../fixtures/electron.mjs';

test('la lettura nomina un sito: la raccolta intera non è una cosa che si possa chiedere', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const corpo = P._internal.corpoQuery({ limit: 50, onlySuccess: true });
    return {
      // Nessun filtro `domain == …`: il dominio è un SEGMENTO del percorso
      // Firestore, e senza nominarlo non esiste una richiesta da mandare.
      corpo: JSON.stringify(corpo),
      segmento: P._internal.segmentoDominio('esempio.it'),
      tetto: P.rest.MAX_PAGE_SIZE,
      sotto: P.configPublic.subcollection,
    };
  });
  expect(r.corpo).not.toContain('domain');
  expect(r.segmento).toBe('esempio.it');
  expect(r.sotto).toBe('entries');
  expect(r.tetto).toBe(200);
});

test('e l\'assistente ritrova i percorsi riusciti del sito nominato, dentro le marcature che li dichiarano roba di fuori', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const blocco = S.formatKnownPathsForPrompt([
      {
        domain: 'negozio-esempio.it',
        initialUrl: '/account/ordini',
        intent: 'aprire la pagina degli ordini',
        steps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
        success: true,
      },
    ]);
    return { blocco, inizio: S.FENCE_START, fine: S.FENCE_END };
  });
  expect(r.blocco.startsWith(r.inizio)).toBe(true);
  expect(r.blocco.trimEnd().endsWith(r.fine)).toBe(true);
  expect(r.blocco).toContain('aprire la pagina degli ordini');
  expect(r.blocco).toContain('/account/ordini');
  expect(r.blocco).toContain('I miei ordini');
});

test('un sito senza percorsi non apre nemmeno il blocco', async ({ app }) => {
  const vuoto = await app.evaluate(async () => globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt([]));
  expect(vuoto).toBe('');
});

test('un nome di host oltre il massimo si rifiuta invece di essere tagliato', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const host = 'a'.repeat(250) + '.localhost';
    const url = `http://${host}/admin/utenti`;
    const pulito = S.sanitizeSubmission({
      domain: host,
      initialUrl: url,
      intent: 'aprire il pannello',
      steps: [{ selector: '[aria-label="Utenti"]', action: 'click' }],
      success: true,
    });
    return {
      interoChiuso: S.sitoCondivisibile(host),
      dominio: S._internal.domainOf(url),
      ripulito: S._internal.sanitizeDomain(host),
      passa: pulito.ok,
      motivo: pulito.reason || '',
    };
  });
  // Il nome intero è chiuso, e adesso il taglio non lo trasforma più in un
  // nome che la lista non riconosce: prima diventava «…a.lo» e passava.
  expect(r.interoChiuso).toBe(false);
  expect(r.dominio).toBe('');
  expect(r.ripulito).toBe('');
  expect(r.passa).toBe(false);
});

test('mentre i nomi di lunghezza normale restano chiusi, col punto finale e senza', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    const nomi = ['app.localhost', 'app.localhost.', 'progetto-rossi.test', 'x.invalid', 'y.example',
      'abc.onion', 'z.alt', 'w.i2p', 'localhost.', 'nas-rossi.local.', '192.168.1.1.'];
    return nomi.map((d) => ({ d, condivisibile: S.sitoCondivisibile(d), segmento: P._internal.segmentoDominio(d) }));
  });
  for (const riga of r) {
    expect(riga.condivisibile, `${riga.d}: non si condivide`).toBe(false);
    expect(riga.segmento, `${riga.d}: non si legge`).toBe('');
  }
});

test('e un sito vero col punto finale resta lo stesso sito, in scrittura e in lettura', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    return {
      scrittura: S._internal.sanitizeDomain('esempio.it.'),
      lettura: P._internal.segmentoDominio('esempio.it.'),
    };
  });
  expect(r.scrittura).toBe('esempio.it');
  expect(r.lettura).toBe('esempio.it');
});
