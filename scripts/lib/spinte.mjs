// Le spinte dichiarate (#1362): il pre-push accoda i commit che la sessione ha creato e sta spingendo, col biglietto di
// chi spinge; l'invio li dichiara al server, e prima di ogni consegna o registrazione si svuota la coda. Le regole le
// tiene il server (fiduciaRamo.commitDichiarati): qui un guasto lascia la coda com'è, e niente decide la fiducia.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { trovaBiglietti, chiamaGrezzo, consegnaSporchi, sporchiInAttesa } from './biglietto-locale.mjs';
import { readTicket } from './routine-ticket.mjs';

// Come TETTO_COMMIT in fiduciaRamo del server: oltre, la spinta si segna «oltre» e il server la legge come buco.
export const TETTO_COMMIT = 5000;
// Come TETTO_SPINTE e TETTO_COMMIT_CHIAMATA del server: oltre, la coda parte in più chiamate.
export const TETTO_SPINTE_CHIAMATA = 500;
export const TETTO_COMMIT_CHIAMATA = 20000;
export const CODA = 'filo-spinte';
const TURNO = '.turno';
// Un invio morto a metà non tiene la coda per sempre.
const TURNO_SCADUTO_MS = 2 * 60 * 1000;
export const ATTESA_TURNO_MS = 20000;
const VUOTO = /^0*$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const BASE_ROUTINE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
const ORIGINE = {
  app: /[:/]sathyaram1\/filo$/,
  server: /[:/]sathyaram1\/filo-security$/,
};

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
}

/** La cartella della coda, nella cartella comune di git (mai committata, la stessa da ogni worktree). '' fuori da un repo. */
export function cartellaCoda(root) {
  try {
    const comune = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    return comune ? join(comune, CODA) : '';
  } catch (_) {
    return '';
  }
}

/**
 * L'origin del clone è il repo che il registro conosce (`app` = Filo, `server` = filo-security)? Un deposito di prova o
 * un altro remoto non si dichiara. `prova` (FILO_SPINTE_ORIGINE): un URL in più da accettare, per le prove.
 */
export function origineDelRegistro(url, repo, prova = process.env.FILO_SPINTE_ORIGINE) {
  const u = String(url || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
  if (prova && u === String(prova).trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')) return true;
  return !!ORIGINE[repo] && ORIGINE[repo].test(u);
}

/**
 * Chi spinge: il biglietto della sessione locale (variabile o nome della sessione), altrimenti quello della routine di
 * questa cartella. null = nessun biglietto, niente da dichiarare (e per il registro i suoi commit restano di nessuno).
 */
export function chiSpinge({ root, env = process.env } = {}) {
  const locali = trovaBiglietti({ env, cwd: root });
  if (locali.length) return { tipo: 'locale', ticket: locali[0].ticket, fp: locali[0].fp, file: locali[0].path };
  const t = String(env.FILO_ROUTINE_TICKET || '').trim() || readTicket(root);
  return t ? { tipo: 'routine', ticket: t } : null;
}

/**
 * I commit che questa copia ha creato fra quelli che `locale` porta su `ramo`: non quelli raggiungibili da un ref remoto,
 * dalla punta che il remoto ha adesso (`remoto`), o da una che il ref remoto del ramo ha avuto (il suo storico): un
 * commit visto su origin l'ha spinto qualcun altro, anche se poi è stato tolto. → { commits, oltre } | null se git tace.
 */
export function commitPropri(root, { locale, remoto = '', ramo = '' } = {}) {
  const escludi = [];
  if (remoto && !VUOTO.test(remoto)) {
    try { git(root, ['cat-file', '-e', `${remoto}^{commit}`]); escludi.push(remoto); } catch (_) { /* non l'abbiamo: contano i ref remoti */ }
  }
  if (ramo) {
    try {
      for (const s of git(root, ['reflog', 'show', '--format=%H', `refs/remotes/origin/${ramo}`, '--']).split('\n')) {
        if (SHA_RE.test(s.trim())) escludi.push(s.trim());
      }
    } catch (_) { /* nessuno storico del ref remoto */ }
  }
  try {
    const input = [locale, ...[...new Set(escludi)].map((s) => `^${s}`)].join('\n') + '\n';
    const out = git(root, ['rev-list', `--max-count=${TETTO_COMMIT + 1}`, '--stdin', '--not', '--remotes'], input);
    const commits = out.split('\n').map((s) => s.trim()).filter((s) => SHA_RE.test(s));
    return { commits: commits.slice(0, TETTO_COMMIT), oltre: commits.length > TETTO_COMMIT };
  } catch (_) {
    return null;
  }
}

/** Le spinte di un pre-push di git (righe «<ref locale> <sha> <ref remoto> <sha>») da accodare. PURA a parte git. */
export function spinteDelPrePush(root, righe) {
  const out = [];
  for (const riga of String(righe || '').split(/\r?\n/)) {
    const [, locale, rif, remoto] = riga.trim().split(/\s+/);
    if (!locale || VUOTO.test(locale) || !SHA_RE.test(locale)) continue;
    const m = /^refs\/heads\/(.+)$/.exec(String(rif || ''));
    if (!m || /^(main|master)$/i.test(m[1])) continue;
    const propri = commitPropri(root, { locale, remoto: SHA_RE.test(String(remoto || '')) ? remoto : '', ramo: m[1] });
    // Senza l'elenco la spinta non si dichiara: i suoi commit restano di nessuno, cioè buco al controllo.
    if (!propri || (!propri.commits.length && !propri.oltre)) continue;
    out.push(Object.assign({ ramo: m[1], punta: locale, commits: propri.commits }, propri.oltre ? { oltre: true } : {}));
  }
  return out;
}

/** Accoda le spinte di `chi` per `repo`. Lancia se non riesce a scrivere. */
export function accoda(root, chi, repo, spinte, nowMs = Date.now()) {
  const dir = cartellaCoda(root);
  if (!dir || !chi || !spinte.length) return 0;
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const s of spinte) {
    const nome = `${String(Math.round(Number(nowMs) || Date.now())).padStart(14, '0')}-${process.pid}-${String(n).padStart(3, '0')}-${randomBytes(3).toString('hex')}.json`;
    const voce = Object.assign({ tipo: chi.tipo, ticket: chi.ticket, repo, at: nowMs }, chi.fp ? { fp: chi.fp } : {}, chi.file ? { file: chi.file } : {}, s);
    // Prima con un altro nome, poi al suo posto: chi legge la coda intanto non trova mai una voce a metà.
    const tmp = join(dir, `${nome}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(voce)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, join(dir, nome));
    n += 1;
  }
  return n;
}

/** Le voci in coda, dalla più vecchia. Una illeggibile si toglie: non si saprebbe a nome di chi mandarla. */
export function vociInCoda(dir) {
  let nomi = [];
  try { nomi = readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch (_) { return []; }
  const out = [];
  for (const n of nomi) {
    const file = join(dir, n);
    try {
      const v = JSON.parse(readFileSync(file, 'utf8'));
      if (v && typeof v.ticket === 'string' && v.ticket && (v.tipo === 'routine' || v.tipo === 'locale')) out.push(Object.assign({ _file: file }, v));
      else rmSync(file, { force: true });
    } catch (_) {
      try { rmSync(file, { force: true }); } catch (__) { /* resta */ }
    }
  }
  return out;
}

/** Le voci a gruppi dello stesso biglietto, nell'ordine, entro i tetti di una chiamata. PURA. */
export function gruppiDi(voci) {
  const gruppi = [];
  let cur = null;
  let commit = 0;
  for (const v of voci) {
    const n = Array.isArray(v.commits) ? v.commits.length : 0;
    if (!cur || cur.tipo !== v.tipo || cur.ticket !== v.ticket || cur.voci.length >= TETTO_SPINTE_CHIAMATA || commit + n > TETTO_COMMIT_CHIAMATA) {
      cur = { tipo: v.tipo, ticket: v.ticket, fp: v.fp || '', file: v.file || '', voci: [] };
      gruppi.push(cur);
      commit = 0;
    }
    cur.voci.push(v);
    commit += n;
  }
  return gruppi;
}

function spinteDi(gruppo) {
  return gruppo.voci.map((v) => Object.assign(
    { repo: v.repo, ramo: v.ramo, commits: Array.isArray(v.commits) ? v.commits : [] },
    v.punta ? { punta: v.punta } : {}, v.oltre === true ? { oltre: true } : {},
  ));
}

/** Manda un gruppo. → { esito: 'ok' | 'rifiutata' | 'guasto' | 'attesa', motivo? }. */
async function manda(gruppo, deps = {}) {
  if (!deps.fetchImpl && process.env.NODE_TEST_CONTEXT) return { esito: 'guasto', motivo: 'niente server vero dentro una prova' };
  if (gruppo.tipo === 'locale') {
    // Uno sporco annotato solo qui va al server prima: altrimenti le spinte entrerebbero pulite.
    const b = { ticket: gruppo.ticket, fp: gruppo.fp, path: gruppo.file };
    if (b.fp && b.path && sporchiInAttesa(b).length) {
      const { restano } = await consegnaSporchi(b, { deps });
      if (restano) return { esito: 'attesa', motivo: 'una lettura esterna è annotata solo qui: le spinte aspettano che il server la riceva' };
    }
    let r;
    try { r = await chiamaGrezzo('spinte', { ticket: gruppo.ticket, spinte: spinteDi(gruppo) }, deps); } catch (e) { return { esito: 'guasto', motivo: String((e && e.message) || e) }; }
    const res = r.body && r.body.result;
    if (r.status === 200 && res && res.ok !== false) return { esito: 'ok' };
    if (r.status === 404) return { esito: 'rifiutata', motivo: 'la funzione localTicket non è ancora pubblicata sul server' };
    if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429) return { esito: 'guasto', motivo: `localTicket ha risposto ${r.status}` };
    return { esito: 'rifiutata', motivo: res ? `${res.reason || 'rifiuto'}${res.detail ? `: ${res.detail}` : ''}` : `localTicket ha risposto ${r.status}` };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  let status = 0;
  let body = null;
  try {
    const res = await fetchImpl(`${deps.base || BASE_ROUTINE}/routineSpinte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: gruppo.ticket, spinte: spinteDi(gruppo) }),
      ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(deps.tempoMs || 20000) } : {}),
    });
    status = res.status;
    try { body = await res.json(); } catch (_) { body = null; }
  } catch (e) {
    return { esito: 'guasto', motivo: String((e && e.message) || e) };
  }
  if (status === 200 && body && body.ok) return { esito: 'ok' };
  // Il server di prima non ha l'indirizzo: non c'è niente a cui dichiarare (e non controlla niente).
  if (status === 404 && !(body && body.reason)) return { esito: 'rifiutata', motivo: 'routineSpinte non è ancora pubblicata sul server' };
  if (status === 0 || status >= 500 || status === 429) return { esito: 'guasto', motivo: `routineSpinte: ${(body && body.reason) || `http_${status}`}` };
  return { esito: 'rifiutata', motivo: `${(body && body.reason) || `http_${status}`}${body && body.detail ? `: ${body.detail}` : ''}` };
}

const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

async function prendiTurno(dir, attesaMs, sleep = dormi) {
  const turno = join(dir, TURNO);
  const fine = Date.now() + Math.max(0, Number(attesaMs) || 0);
  for (;;) {
    try {
      mkdirSync(dir, { recursive: true });
      mkdirSync(turno);
      return turno;
    } catch (e) {
      if (e && e.code !== 'EEXIST') return '';
      try { if (Date.now() - statSync(turno).mtimeMs > TURNO_SCADUTO_MS) { rmSync(turno, { recursive: true, force: true }); continue; } } catch (_) { continue; }
      if (Date.now() >= fine) return '';
      await sleep(200);
    }
  }
}

/**
 * Dichiara al server le spinte in coda nella copia di `root`, una alla volta per copia (chi arriva dopo aspetta fino a
 * `attesaMs`). Mai un'eccezione. → { inviate, rifiutate, restano, guasto?, occupata?, errori }: `restano` = ancora in
 * coda (un guasto, o uno sporco non ancora ricevuto), `rifiutate` = tolte perché il server ha detto no (restano buco).
 */
export async function inviaSpinte({ root, deps = {}, attesaMs = ATTESA_TURNO_MS } = {}) {
  const out = { inviate: 0, rifiutate: 0, restano: 0, errori: [] };
  const dir = cartellaCoda(root);
  if (!dir) return out;
  if (!vociInCoda(dir).length) return out;
  const turno = await prendiTurno(dir, attesaMs, deps.sleep);
  if (!turno) return Object.assign(out, { restano: vociInCoda(dir).length, occupata: true });
  try {
    if (deps.attendiMs) await (deps.sleep || dormi)(deps.attendiMs);
    const tenute = new Set();
    for (let giro = 0; giro < 5; giro += 1) {
      const voci = vociInCoda(dir).filter((v) => !tenute.has(v._file));
      if (!voci.length) break;
      for (const g of gruppiDi(voci)) {
        const r = await manda(g, deps);
        if (r.esito === 'ok' || r.esito === 'rifiutata') {
          for (const v of g.voci) { try { rmSync(v._file, { force: true }); } catch (_) { /* si rimanda: un doppione non cambia niente */ } }
          if (r.esito === 'ok') out.inviate += g.voci.length;
          else { out.rifiutate += g.voci.length; out.errori.push(r.motivo); }
        } else {
          for (const v of g.voci) tenute.add(v._file);
          out.errori.push(r.motivo);
          if (r.esito === 'guasto') out.guasto = true;
        }
      }
    }
    out.restano = vociInCoda(dir).length;
    return out;
  } finally {
    try { rmSync(turno, { recursive: true, force: true }); } catch (_) { /* scade da solo */ }
  }
}

/** Una riga per chi consegna quando la coda non si è svuotata o il server ha rifiutato. '' se è andato tutto. PURA. */
export function rigaSpinte(r) {
  if (!r || (!r.restano && !r.rifiutate)) return '';
  const motivi = [...new Set(r.errori || [])].slice(0, 3).join('; ');
  if (r.restano) return `Spinte non ancora dichiarate al server (${r.restano} in coda${motivi ? `: ${motivi}` : ''}): i loro commit, finché non arrivano, valgono di nessuno e il lavoro non risulta fidato.`;
  return `Spinte rifiutate dal server (${r.rifiutate}${motivi ? `: ${motivi}` : ''}): i loro commit valgono di nessuno e il lavoro non risulta fidato.`;
}
