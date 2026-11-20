// Chi ha servito le ultime richieste pagate coi crediti di Filo (#542): lettura dell'owner, col suo token, delle ultime
// righe del registro d'uso, coi soli campi che la pagina dei predefiniti mostra. Non scrive niente; il conto sta in
// src/shared/wallet.js (contaServito), la pagina in src/pages/manage/managePredefiniti.js.

'use strict';

const COLLEZIONE = 'wallet-usage';
const ATTESA_RETE_MS = 20000;

function daFs(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  return undefined;
}

function crea(dip = {}) {
  const fetchFn = dip.fetch || ((...a) => fetch(...a));
  const rest = dip.rest || (() => (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest) || {});
  const W = () => globalThis.SN_WALLET;

  async function leggi({ idToken } = {}) {
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) throw new Error('server non configurato');
    const limite = W().SERVITO_ULTIME;
    const structuredQuery = {
      from: [{ collectionId: COLLEZIONE }],
      select: { fields: W().SERVITO_CAMPI.map((f) => ({ fieldPath: f })) },
      orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }],
      limit: limite,
    };
    const res = await fetchFn(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ structuredQuery }),
      signal: AbortSignal.timeout(ATTESA_RETE_MS),
    });
    if (!res.ok) {
      let det = '';
      try { const j = await res.json(); det = (Array.isArray(j) ? j[0] : j)?.error?.status || ''; } catch (_) {}
      throw new Error(`registro d'uso ${res.status}${det ? ` ${det}` : ''}`);
    }
    const corpo = await res.json();
    const righe = (Array.isArray(corpo) ? corpo : [])
      .filter((r) => r && r.document)
      .map((r) => {
        const f = r.document.fields || {};
        return Object.fromEntries(W().SERVITO_CAMPI.map((k) => [k, daFs(f[k])]));
      });
    return { limite, ...W().contaServito(righe) };
  }

  return { leggi };
}

module.exports = { crea, COLLEZIONE };
