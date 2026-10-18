// La priorità di un feedback scritta a riga di comando: quella che apre (claude-feedback) e quella che cambia (owner-feedback).
// PURA. Le scritture vere stanno negli strumenti; le prove in tests/unit/ownerFeedbackPriorita.test.mjs.

/** La scala è 3/2/1/0: lo 0 è un gradino («vale zero»), non «nessuna». */
export const PRIORITA_AMMESSE = Object.freeze([0, 1, 2, 3]);

/**
 * Assente = non impostata. Il resto deve essere una cifra della scala: «3.0», « » o «0x3» non sono
 * una priorità scritta da qualcuno, e scriverne una inventata è peggio che fermarsi.
 * @returns {{ ok: true, valore: number|null } | { ok: false, motivo: string }}
 */
export function parsePriorita(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, valore: null };
  const s = String(raw).trim();
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  if (!PRIORITA_AMMESSE.includes(n)) {
    return { ok: false, motivo: `priorità "${raw}" non valida: ammessi ${PRIORITA_AMMESSE.join(', ')}` };
  }
  return { ok: true, valore: n };
}
