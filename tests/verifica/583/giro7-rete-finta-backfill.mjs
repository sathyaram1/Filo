// Verifica #583, giro 7 — la rete finta sotto `backfill-feedback-numbers`.
//
// NON è uno spec (niente `.spec.mjs`): è il modulo che
// `giro7-backfill-ordine.spec.mjs` inietta con `node --import` prima di far
// partire lo script vero, così lo script gira intero — credenziali, lettura,
// assegnazione — senza toccare la rete.
//
// Tre feedback senza numero. L'ordine per NOME del documento è l'opposto di
// quello per data d'invio: chi ordina davvero per data d'invio deve dare #1 al
// più vecchio.

const DOCS = [
  // [id, createdAt] — per nome crescente: aaa, bbb, ccc; per data: ccc, bbb, aaa.
  ['aaa-recente', '2026-03-03T10:00:00.000Z'],
  ['bbb-mezzo', '2026-02-02T10:00:00.000Z'],
  ['ccc-vecchio', '2026-01-01T10:00:00.000Z'],
];

function risposta(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  // Lo scambio del refresh token admin con un id token.
  if (u.includes('securetoken') || u.includes('token?key=')) {
    return risposta({ id_token: 'token-finto', access_token: 'token-finto' });
  }

  // La lettura della collezione.
  if (u.includes(':runQuery')) {
    const body = JSON.parse(String(opts.body || '{}'));
    const sq = body.structuredQuery || {};
    // Se qualcuno avesse ancora un cursore, la seconda pagina è vuota.
    if (sq.startAt) return risposta([]);
    return risposta(DOCS.map(([id, createdAt]) => ({
      document: {
        name: `projects/filo/databases/(default)/documents/feedback/${id}`,
        fields: {
          name: { stringValue: `Titolo di ${id}` },
          text: { stringValue: 'testo' },
          createdAt: { timestampValue: createdAt },
        },
      },
    })));
  }

  throw new Error(`rete finta: chiamata non prevista a ${u}`);
};
