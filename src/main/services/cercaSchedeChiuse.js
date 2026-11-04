// Le schede chiuse che SCHEDE_CHIUSE dà alla chat (#884): chi le ha chiuse, il filtro per periodo e motivo, la forma
// di ogni voce. Logica pura sulle voci d'archivio che riceve: la ricerca per parole e per senso la fa handlers.js.
// Regole: tests/unit/cercaSchedeChiuse.test.mjs.

'use strict';

// 'mano', 'pagina' (la pagina stessa o un crash), 'filo' (chiesto in chat), 'pulizia' (il riordino o l'inattività),
// 'doppione'. Le voci di prima non lo scrivono: si legge dal `reason` di allora. Lo strumento li offre al modello
// con lo stesso elenco: la sentinella in tests/unit/cercaSchedeChiuse.test.mjs li tiene uguali.
const MOTIVI = ['mano', 'pagina', 'filo', 'pulizia', 'doppione'];
const SINONIMI = {
  utente: 'mano', io: 'mano', manuale: 'mano', assistente: 'filo', chat: 'filo', tu: 'filo',
  riordino: 'pulizia', inattivita: 'pulizia', automatica: 'pulizia', archiviata: 'pulizia', duplicato: 'doppione',
};
// Quante ne tornano al modello: abbastanza per «quelle archiviate stamattina», il resto lo dice il conto.
const TETTO = 15;
const RIASSUNTO_MAX = 400;

function motivoDi(t) {
  if (t && MOTIVI.includes(t.motivo)) return t.motivo;
  const r = t && t.reason;
  if (!r || r === 'manual') return t && t.chiusaDaSola ? 'pagina' : 'mano';
  return r === 'duplicato' ? 'doppione' : 'pulizia';
}

function eventi() {
  if (!globalThis.SN_FILO_EVENTI) require('../../shared/filoEventi.js');
  return globalThis.SN_FILO_EVENTI;
}

// { cerca, periodo, motivo } o { errore } con la frase che dice come rimediare.
function richiesta(action, { ora } = {}) {
  const a = action || {};
  const cerca = String(a.cerca ?? a.query ?? a.testo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const m = String(a.motivo ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const motivo = m ? (MOTIVI.includes(m) ? m : SINONIMI[m] || null) : '';
  if (motivo === null) return { errore: `motivo non capito: usa ${MOTIVI.join(', ')}` };
  const periodo = eventi().periodo('tutto', { da: a.da, a: a.a, ...(ora ? { ora } : {}) });
  if (!periodo) return { errore: 'periodo non capito: `da` e `a` vogliono un istante ISO o un giorno AAAA-MM-GG, con `da` prima di `a`' };
  return { cerca, periodo, motivo };
}

// Le voci nel periodo e col motivo chiesti, dalla chiusa più di recente.
function filtra(voci, { periodo = { da: null, a: null }, motivo = '' } = {}) {
  const t0 = periodo.da ? Date.parse(periodo.da) : -Infinity;
  const t1 = periodo.a ? Date.parse(periodo.a) : Infinity;
  return (Array.isArray(voci) ? voci : [])
    .filter((v) => v && typeof v.id === 'string' && typeof v.url === 'string')
    .filter((v) => { const t = Date.parse(v.closedAt); return Number.isFinite(t) ? t >= t0 && t <= t1 : t0 === -Infinity && t1 === Infinity; })
    .filter((v) => !motivo || motivoDi(v) === motivo)
    .sort((x, y) => (Date.parse(y.closedAt) || 0) - (Date.parse(x.closedAt) || 0));
}

// La voce come la vede il modello. `delicata`: una pagina delicata o di casa, di cui escono solo il sito e il quando
// (#1004); un indirizzo tagliato alla misura (#1525) porterebbe altrove, e va solo il sito.
function perModello(v, { delicata = false } = {}) {
  let origine = '';
  try { origine = new URL(v.url).origin; } catch (_) {}
  const sito = origine.replace(/^https?:\/\/(www\.)?/, '');
  const riassunto = delicata ? '' : String(v.summary || '').replace(/\s+/g, ' ').trim();
  return {
    id: v.id,
    titolo: delicata ? (sito || 'sito') : String(v.title || '').slice(0, 200),
    url: delicata || v.urlTagliato ? (origine ? `${origine}/` : '') : v.url,
    ...(delicata ? { delicata: true } : {}),
    chiusa: v.closedAt || null,
    motivo: motivoDi(v),
    ...(v.giro ? { giro: v.giro } : {}),
    ...(v.urlTagliato ? { tagliato: true } : {}),
    riassunto: riassunto.length > RIASSUNTO_MAX ? `${riassunto.slice(0, RIASSUNTO_MAX - 1)}…` : riassunto,
  };
}

module.exports = { MOTIVI, TETTO, motivoDi, richiesta, filtra, perModello };
