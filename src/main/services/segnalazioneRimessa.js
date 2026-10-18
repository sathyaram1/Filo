// Il testo di una segnalazione che la coda butta (cifratura impossibile, o un giorno di tentativi) torna al riquadro dei
// feedback del sito dove era stato scritto, che lo rimette nel campo alla prossima apertura (#602.1). Niente rete.
// Chiave per sito come le bozze (BOZZE_PER_SITO, #1071); regole in tests/unit/segnalazioneRimessa.test.mjs.

const CHIAVE = 'sn_feedback_rimessa';

/** La chiave del riquadro aperto su `url`, la stessa che SN_FILO_UI.chiaveDiBozza calcola nella pagina; null senza sito. PURA. */
function chiaveRimessa(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (u.protocol === 'filo:') return CHIAVE;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return `${CHIAVE}@${u.origin}`;
}

/** `testo` in fondo a `prima`, una volta sola. PURA. */
function accoda(prima, testo) {
  const p = typeof prima === 'string' ? prima : '';
  const t = String(testo || '');
  if (!t.trim() || p.includes(t)) return p;
  return p.trim() ? `${p}\n\n${t}` : t;
}

/** La frase che dice dove ritrovare il testo; '' se non c'è niente da rimettere. PURA. */
function fraseRimessa(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (!String(p.text || '').trim() || !chiaveRimessa(p.url)) return '';
  const u = new URL(String(p.url));
  const dove = u.protocol === 'filo:' ? '' : ` su ${u.hostname}`;
  const allegati = (Array.isArray(p.images) ? p.images.length : 0) + (Array.isArray(p.files) ? p.files.length : 0);
  return `Quello che avevi scritto è di nuovo nel riquadro dei feedback${dove}, pronto da rimandare.`
    + `${allegati ? ' Gli allegati vanno rimessi.' : ''}`;
}

/** Mette il testo della segnalazione dove il riquadro di quel sito lo ritrova. Ritorna true se l'ha messo. */
async function rimetti(payload, storage = require('../shim/storage')) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const chiave = chiaveRimessa(p.url);
  const testo = String(p.text || '');
  if (!chiave || !testo.trim()) return false;
  const letto = await storage.get([chiave]);
  const prima = letto && typeof letto[chiave] === 'string' ? letto[chiave] : '';
  const dopo = accoda(prima, testo);
  if (dopo !== prima) await storage.set({ [chiave]: dopo });
  return true;
}

module.exports = { CHIAVE, chiaveRimessa, accoda, fraseRimessa, rimetti };
