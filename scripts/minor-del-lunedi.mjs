// La minor del lunedì, la versione del canale stabile (SPEC-DOMANDE.md §4.2): quale corsa di release.yml è la sua,
// se il server la permette e il numero x.y.0 che scrive lui. I feedback di sicurezza aperti li guarda il server: da qui
// non se ne vede nessuno, e nel registro pubblico della corsa non se ne nomina nessuno. Regole: tests/unit/minorDelLunedi.test.mjs.

const BASE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const RELEASE_MINOR_URL = `${BASE}/releaseMinor`;

// Lunedì alle 00:00 a Roma: le 22 UTC con l'ora legale, le 23 con quella solare. Sono gli stessi di release.yml.
export const CRON_MINOR = Object.freeze(['0 22 * * 0', '0 23 * * 0']);
// Una corsa programmata in ritardo esce lo stesso, fino alle sei; la seconda della notte la ferma il server (una a settimana).
export const ORE_FINESTRA = 6;

const GIORNI = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Giorno della settimana (1 lunedì … 7 domenica), ora e data a Roma. PURA. */
export function oraDiRoma(quando = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(quando).map((x) => [x.type, x.value]));
  return { giorno: GIORNI[p.weekday], ora: Number(p.hour), data: `${p.year}-${p.month}-${p.day}` };
}

export function nellaFinestra(quando = new Date()) {
  const r = oraDiRoma(quando);
  return r.giorno === 1 && r.ora < ORE_FINESTRA;
}

/** 'minor-programmata', 'minor-a-mano' o 'patch', dall'evento che ha fatto partire la corsa. PURA. */
export function tipoDellaCorsa({ evento, cron, aMano } = {}) {
  if (evento === 'schedule' && CRON_MINOR.includes(String(cron || '').trim())) return 'minor-programmata';
  if (evento === 'workflow_dispatch' && (aMano === true || aMano === 'true')) return 'minor-a-mano';
  return 'patch';
}

export function eMinor(v) {
  return /^\d+\.\d+\.0$/.test(String(v || ''));
}

/** La risposta del server, per la domanda («si può?») e per l'aumento. PURA. */
export function classificaMinor(status, body) {
  const b = body || {};
  if (status === 200 && b.ok === true) {
    if (b.permessa === true) return { outcome: 'permessa' };
    if (b.permessa === false) return { outcome: 'rinviata', motivo: b.motivo === 'settimana' ? 'settimana' : 'rinviata' };
    const version = String(b.version || '');
    // Un numero che non è una minor vuol dire un server che non conosce la minor: costruirla col suo numero sarebbe una patch.
    if (!eMinor(version)) return { outcome: 'fault', reason: `il server non ha dato una minor: "${version}"` };
    return { outcome: 'done', version, previous: String(b.previous || ''), sha: String(b.sha || '') };
  }
  const reason = String(b.reason || '') || `http_${status}`;
  if (status === 409) return { outcome: 'rinviata', motivo: reason === 'settimana' ? 'settimana' : 'rinviata' };
  if (status === 429) return { outcome: 'throttled', reason };
  if (status === 404) return { outcome: 'not_deployed', reason };
  if (status === 0 || status >= 500) return { outcome: 'unreachable', reason };
  if (status === 401 || status === 403) return { outcome: 'denied', reason };
  if (status === 400) return { outcome: 'rejected', reason };
  return { outcome: 'fault', reason };
}

/** `controllo`: solo la domanda, il server non scrive niente. Sempre un esito, mai un'eccezione. */
export async function chiediMinor({ passphrase, controllo = false, fetchImpl = fetch, url = RELEASE_MINOR_URL } = {}) {
  if (!passphrase) return { outcome: 'no_passphrase' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(controllo ? { passphrase, controllo: true } : { passphrase }),
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
    return classificaMinor(res.status, body);
  } catch (e) {
    return { outcome: 'unreachable', reason: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Il motivo di una minor che non esce, come si scrive nel registro pubblico della corsa. PURA. */
export function fraseRinvio(motivo) {
  return motivo === 'settimana'
    ? 'la minor di questa settimana è già uscita.'
    : 'il server la rinvia alla settimana prossima; il motivo lo tiene lui, e lo legge il monitoraggio.';
}

/**
 * La corsa della minor, dati il permesso del server e il commit verde: `sha` da pubblicare ('' se niente), le righe del
 * riassunto, e `rossa` se è un guasto che deve lasciare la corsa rossa. Il verde può essere lo stesso commit dell'ultima
 * patch: la minor porta sullo stabile quello che il veloce ha già. PURA.
 */
export function decidiMinor({ tipo, finestra, permesso, verde, tag, verdeOk } = {}) {
  const righe = ['## La minor del lunedì (canale stabile)', ''];
  const esito = (sha, riga, rossa = false) => ({ sha, rossa, righe: [...righe, `- ${riga}`] });
  if (tipo === 'minor-programmata' && !finestra) return esito('', 'Fuori dalla finestra del lunedì (00:00–06:00 a Roma): questa corsa non pubblica niente.');
  const p = permesso || {};
  if (p.outcome === 'rinviata') return esito('', `Niente minor: ${fraseRinvio(p.motivo)}`);
  if (p.outcome !== 'permessa') {
    return esito('', `Il permesso del server non è arrivato (${p.outcome || 'nessuna risposta'}${p.reason ? `: ${p.reason}` : ''}): la minor di questa settimana non esce.`, true);
  }
  // Senza verdi da 48 ore il fermo lo segnala già la corsa delle sei ore.
  if (!verde) return esito('', 'Niente minor: nessun commit di main ha la suite verde fra le ultime corse riuscite.');
  if (!verdeOk) return esito('', `Niente minor: il commit verde \`${verde}\` è più vecchio di ${tag}.`, true);
  return esito(verde, `Si pubblica come minor \`${verde}\`, il commit più nuovo di main con la suite verde${tag ? ` (l'ultima versione è ${tag})` : ''}.`);
}
