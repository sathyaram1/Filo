// «Riprova» di uno scaricamento che conosce la sua pagina (#1684.1): i byte li prende net.request, che presenta il Referer
// come il clic sul link, e la voce di prima li segue come un «Salva immagine come…». Anche i pezzi comuni ai byte presi
// dal main (nome dalle intestazioni, spostamento fra dischi), che usa pure handlers/misc.js.

const fs = require('node:fs');

// Un file da un'ora è legittimo, mezzo minuto di silenzio assoluto no.
const INATTIVITA_MS = 30000;
const MAX_RIMANDI = 10;

// Stesso volume: rinomina istantanea. Altro disco: copia a blocchi, mai passando dalla memoria.
async function moveInto(from, to) {
  try {
    await fs.promises.rename(from, to);
    return;
  } catch (e) {
    if (!e || (e.code !== 'EXDEV' && e.code !== 'EPERM' && e.code !== 'EACCES')) throw e;
  }
  await fs.promises.copyFile(from, to);
  try { await fs.promises.unlink(from); } catch (_) {}
}

// Nome file dal Content-Disposition se c'è, altrimenti dal path dell'URL.
function filenameFromHeaders(hdrs, url) {
  try {
    const cd = hdrs && hdrs['content-disposition'];
    if (cd) {
      // filename*=UTF-8''… (RFC 5987) ha priorità su filename=…
      let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
      if (m) { try { return decodeURIComponent(m[1].trim().replace(/^["']|["']$/g, '')); } catch (_) { return m[1]; } }
      m = /filename=("?)([^";]+)\1/i.exec(cd);
      if (m) return m[2].trim();
    }
  } catch (_) {}
  return filenameFromUrl(url);
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
    return base || '';
  } catch (_) { return ''; }
}

// Segue i rimandi a mano: a ogni passo il Referer si ricalcola per il nuovo indirizzo, come farebbe il browser.
async function rispostaConPagina(ses, indirizzo, pagina, signal) {
  const D = require('./downloads');
  const { richiestaDiRete } = require('./perContoDellaScheda');
  let ua = '';
  try { ua = typeof ses.getUserAgent === 'function' ? ses.getUserAgent() : ''; } catch (_) {}
  let corrente = indirizzo;
  for (let i = 0; i <= MAX_RIMANDI; i++) {
    const referer = D.refererPer(pagina, corrente);
    // La politica dà lo stesso Referer che mandiamo: il servizio di rete annulla le richieste che non tornano.
    const passo = await richiestaDiRete(ses, corrente, {
      headers: { 'User-Agent': ua, Referer: referer }, credenziali: 'include',
      referrerPolicy: referer ? 'strict-origin-when-cross-origin' : 'no-referrer', signal,
    });
    if (!passo.rimando) return { risposta: passo.risposta, servito: corrente };
    const prossimo = new URL(passo.rimando, corrente);
    if (prossimo.protocol !== 'http:' && prossimo.protocol !== 'https:') throw new Error('rimando non scaricabile');
    corrente = prossimo.href;
  }
  throw new Error('troppi rimandi');
}

async function riprova({ id, scope = '', ses, indirizzo, pagina, nome }) {
  const D = require('./downloads');
  const entry = D.beginManual({ url: indirizzo, filename: nome, scope, riusa: id, pagina, sessione: ses, annuncia: true });
  const ac = new AbortController();
  let fermo = null;
  const riarma = () => { clearTimeout(fermo); fermo = setTimeout(() => ac.abort(), INATTIVITA_MS); };
  let parte = '';
  const togliParte = async () => { if (parte) { try { await fs.promises.unlink(parte); } catch (_) {} } };
  riarma();
  try {
    const { risposta, servito } = await rispostaConPagina(ses, indirizzo, pagina, ac.signal);
    if (!risposta.ok || !risposta.body) {
      try { await risposta.body?.cancel?.(); } catch (_) {}
      throw new Error(`HTTP ${risposta.status}`);
    }
    if (entry.cancelled()) { try { await risposta.body.cancel(); } catch (_) {} return; }
    entry.servito(servito);
    const atteso = parseInt(risposta.headers.get('content-length'), 10);
    const totale = Number.isFinite(atteso) && atteso > 0 ? atteso : 0;
    const scelto = D.safeName(filenameFromHeaders({ 'content-disposition': risposta.headers.get('content-disposition') || '' }, servito) || nome, nome);
    entry.nomina(scelto);
    // Un programma passa dalla domanda di Filo come al primo tentativo (#588): i byte crescono in quarantena.
    const via = entry.permesso(scelto);
    parte = D.uniquePath(entry.cartella(), `${scelto}.filo-part`);
    entry.progress(0, totale);
    let ricevuti = 0;
    const out = fs.createWriteStream(parte);
    const lettore = risposta.body.getReader();
    try {
      for (;;) {
        const { done, value } = await lettore.read();
        if (done) break;
        riarma();
        if (entry.cancelled()) throw new Error('annullato');
        ricevuti += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        entry.progress(ricevuti, totale);
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    // Un Content-Length dichiarato e non raggiunto è una risposta troncata, non un file valido.
    if ((totale && ricevuti < totale) || !ricevuti) throw new Error('scaricamento interrotto');
    clearTimeout(fermo);
    if (!(await via) || entry.cancelled()) { await togliParte(); return; }
    const finale = D.uniquePath(D.downloadsDir(), scelto);
    await moveInto(parte, finale);
    parte = '';
    await entry.done(finale);
  } catch (_) {
    await togliParte();
    if (!entry.cancelled()) entry.fail();
  } finally {
    clearTimeout(fermo);
  }
}

module.exports = { riprova, moveInto, filenameFromHeaders, filenameFromUrl };
