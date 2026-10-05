// Rimette in piedi la richiesta di fusione di una pratica ferma in `design`/`l5` senza richiesta (#1038).
// Non decide niente: chiede a `ownerMerge` (ramo del documento, punta letta da GitHub, id della pratica),
// che rifà L5 sul diff e apre la richiesta legata alla pratica. Gli esiti li dice manageReview.esitoRiapriFusione.

const SHA = /^[0-9a-f]{40}$/;

// Il nome finisce in un URL di GitHub: niente flag, niente `..`, solo i caratteri di un ramo. Il server rivalida.
function isValidBranch(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !name.startsWith('-')
    && /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..');
}

/** Il repo da cui escono gli aggiornamenti è anche quello su cui si fonde: un posto solo, package.json. */
function repoDelProgetto() {
  try {
    const pub = require('../../../package.json').build.publish;
    const p = Array.isArray(pub) ? pub[0] : pub;
    if (p && p.owner && p.repo) return `${p.owner}/${p.repo}`;
  } catch (_) { /* sotto c'è il ripiego */ }
  return 'sathyaram1/Filo';
}

/**
 * La punta del ramo su GitHub. Mai un'eccezione.
 * @returns {Promise<{stato:'ok', sha:string}|{stato:'assente'}|{stato:'ignota', motivo:string}>}
 */
async function puntaDaGitHub(branch, { fetchImpl = fetch, base = process.env.FILO_GITHUB_API || 'https://api.github.com', repo = repoDelProgetto() } = {}) {
  const url = `${base}/repos/${repo}/git/ref/heads/${String(branch).split('/').map(encodeURIComponent).join('/')}`;
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Filo' },
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(15000) } : {}),
    });
    if (res.status === 404) return { stato: 'assente' };
    if (!res.ok) return { stato: 'ignota', motivo: `http_${res.status}` };
    const j = await res.json();
    const sha = String((j && j.object && j.object.sha) || '');
    return SHA.test(sha) ? { stato: 'ok', sha } : { stato: 'ignota', motivo: 'risposta senza commit' };
  } catch (e) {
    return { stato: 'ignota', motivo: String((e && e.message) || e).slice(0, 120) };
  }
}

/** Un errore HTTP della callable come esito con un nome: un 404 è una funzione non pubblicata, non un ramo assente. */
function esitoDaErrore(e) {
  const st = Number(e && e.httpStatus) || 0;
  const detail = String((e && (e.detail || e.message)) || '').slice(0, 300);
  if (st === 404) return { ok: true, esito: 'non_pubblicata' };
  if (st === 401 || st === 403) return { ok: true, esito: 'negata', reason: detail };
  if (st === 400) return { ok: true, esito: 'rifiutata', reason: detail };
  return { ok: true, esito: 'server_giu', reason: detail || (st ? `http_${st}` : 'rete') };
}

/** La risposta di `ownerMerge` (il `result` della callable) come esito con un nome. PURA. */
function esitoDaRisposta(r) {
  const v = r || {};
  if (v.ok === true) {
    if (v.result === 'blocked') {
      const requestId = String(v.requestId || '').trim();
      return requestId
        ? { ok: true, esito: 'richiesta', requestId, reason: String(v.reason || '') }
        : { ok: true, esito: 'senza_richiesta', reason: String(v.reason || '') };
    }
    if (v.result === 'merged') return { ok: true, esito: 'fuso', sha: String(v.sha || '') };
    if (v.result === 'conflict') return { ok: true, esito: 'conflitto', reason: String(v.reason || '') };
    if (v.result === 'stale') return { ok: true, esito: 'ramo_mosso' };
    if (v.result === 'unit_rossi') return { ok: true, esito: 'unit_rossi', reason: String(v.reason || '') };
    if (v.result === 'main_moved') return { ok: true, esito: 'ramo_mosso' };
    return { ok: true, esito: 'inatteso', reason: String(v.result || '') };
  }
  const reason = String(v.reason || v.detail || '');
  if (reason === 'github_no_token') return { ok: true, esito: 'senza_credenziale' };
  if (reason === 'github_unreachable' || /^github_5/.test(reason)) return { ok: true, esito: 'server_giu', reason };
  return { ok: true, esito: 'rifiutata', reason };
}

/**
 * @param {object} d
 * @param {string} d.feedbackId
 * @param {(id:string)=>Promise<object|null>} d.leggiPratica  documento già decifrato, o null
 * @param {(branch:string)=>Promise<object>} d.puntaDelRamo   come puntaDaGitHub
 * @param {(data:object)=>Promise<object>} d.chiedi           la callable `ownerMerge`; lancia sugli errori HTTP
 * @param {(fb:object)=>{status:string, statusReason:string|null}} d.normalizeStatus
 */
async function riapriFusione({ feedbackId, leggiPratica, puntaDelRamo, chiedi, normalizeStatus }) {
  const id = String(feedbackId || '').trim();
  if (!id) return { ok: false, error: 'Manca la pratica di cui chiedere la fusione.' };
  const doc = await leggiPratica(id);
  if (!doc) return { ok: true, esito: 'feedback_assente' };
  // Si chiede solo per una pratica ferma al cancello: un pannello rimasto aperto non fonde un ramo a metà lavoro.
  const { status, statusReason } = normalizeStatus(doc);
  if (status !== 'design' || statusReason !== 'l5') return { ok: true, esito: 'non_ferma' };
  const branch = String(doc.branch || '').trim();
  if (!branch) return { ok: true, esito: 'ramo_assente' };
  if (!isValidBranch(branch)) return { ok: true, esito: 'ramo_assente', reason: 'nome del ramo non valido' };
  const punta = await puntaDelRamo(branch);
  if (punta && punta.stato === 'assente') return { ok: true, esito: 'ramo_assente', branch };
  // Senza la punta si chiede lo stesso: il server la risolve comunque da sé, lo sha è solo il controllo in più.
  const data = { branch, feedbackId: id };
  if (punta && punta.stato === 'ok') data.sha = punta.sha;
  let r;
  try {
    r = await chiedi(data);
  } catch (e) {
    return { ...esitoDaErrore(e), branch };
  }
  return { ...esitoDaRisposta(r), branch };
}

module.exports = { riapriFusione, puntaDaGitHub, esitoDaRisposta, esitoDaErrore, repoDelProgetto };
