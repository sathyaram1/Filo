// Schede e testi dei feedback su due strade (#1785): in una routine col biglietto passano dal server (`routineFeedback`),
// in locale dal token dell'owner. Il server rimanda campi in chiaro e la cornice la mette l'app su tutte e due, così
// l'uscita è la stessa. Regole: tests/unit/feedbackCloud.test.mjs; lato server functions/src/routine/schede.js.

export const INDIRIZZO_OWNER = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerSchede';
// Il freno del server conta 30 chiamate al minuto per biglietto: gli agenti delle schede in parallelo lo possono toccare.
const ATTESE_429_MS = [10_000, 20_000, 30_000, 45_000, 60_000];
// I no che dipendono dal feedback o dalla scheda, non dal momento: rimandare la stessa scheda avrebbe la stessa risposta.
export const RIFIUTI_DEFINITIVI = Object.freeze(['feedback_segnalato', 'feedback_inesistente', 'scheda_non_valida']);

/** 'cloud' in una routine (FILO_ROUTINE acceso) col biglietto; 'locale' altrimenti, col token dell'owner. PURA. */
export function stradaFeedback({ env = {}, biglietto = '' } = {}) {
  const routine = Boolean(env.FILO_ROUTINE) && env.FILO_ROUTINE !== '0';
  return routine && String(biglietto || '').trim() ? 'cloud' : 'locale';
}

/** Il biglietto del giro, se c'è (variabile o marcatore di dispatch). */
export async function bigliettoDelGiro(root) {
  const { readTicket } = await import('./routine-ticket.mjs');
  return readTicket(root);
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Una chiamata a `routineFeedback`. → { ok:true, …risposta } | { ok:false, guasto, motivo }. `guasto` = il server non
 * risponde o non ha ancora l'operazione: ritentare più tardi; senza, è un no da leggere.
 */
export async function chiamaFeedback(ticket, corpo, { chiama = null, attendi = dorme } = {}) {
  const call = chiama || (await import('../routine-channel.mjs')).call;
  for (let i = 0; ; i++) {
    const { status, body } = await call('routineFeedback', { ticket, ...corpo });
    const b = body || {};
    if (status === 429 && i < ATTESE_429_MS.length) { await attendi(ATTESE_429_MS[i]); continue; }
    if (status === 200 && b.ok) return { ...b, ok: true };
    if (status === 404 && !b.reason) return { ok: false, guasto: true, motivo: 'routineFeedback non è ancora pubblicata sul server' };
    const motivo = `${b.reason || `http_${status}`}${b.detail ? `: ${b.detail}` : ''}`;
    return { ok: false, guasto: status >= 500 || status === 0 || status === 429, motivo, reason: String(b.reason || '') };
  }
}

/**
 * Tutte le pagine di una lettura, e gli allegati rinviati chiesti uno per uno. `numeri`: elenco o 'aperti'.
 * → { ok:true, voci } | { ok:false, guasto, motivo }
 */
export async function leggiDalServer(ticket, { numeri, testi = false, schede = true }, opz = {}) {
  const voci = [];
  let chiesti = numeri;
  for (;;) {
    const r = await chiamaFeedback(ticket, { op: 'leggi', numeri: chiesti, testi, schede }, opz);
    if (!r.ok) return r;
    const pagina = Array.isArray(r.voci) ? r.voci : [];
    voci.push(...pagina);
    const resto = Array.isArray(r.resto) ? r.resto : [];
    if (!resto.length) break;
    if (!pagina.length) return { ok: false, guasto: true, motivo: `il server ha lasciato ${resto.length} feedback senza darne nessuno` };
    chiesti = resto;
  }
  for (const v of voci) {
    const allegati = (v.testi && Array.isArray(v.testi.allegati)) ? v.testi.allegati : [];
    for (const [indice, a] of allegati.entries()) {
      if (!a || !a.rinviato) continue;
      const r = await chiamaFeedback(ticket, { op: 'leggi', numeri: [v.num], testi: true, schede: false, allegato: indice }, opz);
      allegati[indice] = r.ok && r.allegato ? r.allegato : { name: a.name, type: a.type, errore: `rinviato e non riletto: ${r.motivo || 'risposta vuota'}` };
    }
  }
  return { ok: true, voci };
}

/** La scheda nel feedback, dalla routine. → { ok:true, scheda, aggiornato } | { ok:false, guasto, motivo } */
export function salvaSchedaDalServer(ticket, { numero, scheda, rilettura = false, modello = '' }, opz = {}) {
  return chiamaFeedback(ticket, { op: 'scheda', numero: String(numero), scheda, rilettura, modello }, opz);
}

/** La stessa scrittura dalla macchina dell'owner, con le sue credenziali (`ownerSchede`). */
export async function salvaSchedaDaOwner({ numero, scheda, rilettura = false, modello = '' }, { fetchImpl = fetch, idToken = null, nuovoToken = null } = {}) {
  let token = idToken;
  try {
    // Anche le credenziali che non si rinnovano sono un esito: un lancio qui fermerebbe tutto il giro delle schede.
    if (!token && nuovoToken) token = await nuovoToken();
    if (!token) {
      const { findAdminRefreshToken, mintIdToken } = await import('./firestore-auth.mjs');
      const refresh = findAdminRefreshToken();
      if (!refresh) return { ok: false, guasto: true, motivo: 'non trovo le credenziali del proprietario (FILO_ADMIN_REFRESH_TOKEN)' };
      token = await mintIdToken(refresh);
    }
    const res = await fetchImpl(INDIRIZZO_OWNER, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { op: 'scheda', numero: String(numero), scheda, rilettura, modello } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.result && body.result.ok) return { ...body.result, ok: true };
    if (res.status === 404 && !body.error) return { ok: false, guasto: true, motivo: 'ownerSchede non è ancora pubblicata sul server' };
    const err = body.error || {};
    return {
      ok: false, guasto: res.status >= 500 || res.status === 429, motivo: String(err.message || `errore ${res.status}`),
      reason: String((err.details && err.details.reason) || ''),
    };
  } catch (e) {
    const motivo = String((e && e.message) || e).slice(0, 200);
    return { ok: false, guasto: true, motivo: e && e.credenziale ? `credenziali del proprietario rifiutate: ${motivo}` : `server non raggiungibile: ${motivo}` };
  }
}
