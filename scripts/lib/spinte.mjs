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
  const escludi = punteViste(root, { remoto, ramo });
  try {
    const input = [locale, ...escludi.map((s) => `^${s}`)].join('\n') + '\n';
    const out = git(root, ['rev-list', `--max-count=${TETTO_COMMIT + 1}`, '--stdin', '--not', '--remotes'], input);
    const commits = out.split('\n').map((s) => s.trim()).filter((s) => SHA_RE.test(s));
    return { commits: commits.slice(0, TETTO_COMMIT), oltre: commits.length > TETTO_COMMIT };
  } catch (_) {
    return null;
  }
}

/** Le punte che `ramo` ha avuto su origin in questa copia: quella del remoto adesso (`remoto`, se l'abbiamo) e lo storico del ref remoto. */
function punteViste(root, { remoto = '', ramo = '' } = {}) {
  const punte = [];
  if (remoto && !VUOTO.test(remoto)) {
    try { git(root, ['cat-file', '-e', `${remoto}^{commit}`]); punte.push(remoto); } catch (_) { /* non l'abbiamo: contano i ref remoti */ }
  }
  if (ramo) {
    try {
      for (const s of git(root, ['reflog', 'show', '--format=%H', `refs/remotes/origin/${ramo}`, '--']).split('\n')) {
        if (SHA_RE.test(s.trim())) punte.push(s.trim());
      }
    } catch (_) { /* nessuno storico del ref remoto */ }
  }
  return [...new Set(punte)];
}

/**
 * I commit visti su origin per `ramo` che `locale` non porta più e main non ha: la spinta li riscrive (un rebase) o li
 * toglie, e il server vuole che un biglietto pulito li avesse dichiarati (#1362 giro 2 r1). Senza le fusioni, che un
 * rebase non ricopia. → { sostituiti, oltre } | null se git tace.
 */
export function commitSostituiti(root, { locale, remoto = '', ramo = '' } = {}) {
  const punte = punteViste(root, { remoto, ramo });
  if (!punte.length) return { sostituiti: [], oltre: false };
  let main = '';
  try { main = git(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}']).trim(); } catch (_) { /* senza main resta tutto il visto */ }
  try {
    const input = [...punte, `^${locale}`, ...(SHA_RE.test(main) ? [`^${main}`] : [])].join('\n') + '\n';
    const out = git(root, ['rev-list', '--no-merges', `--max-count=${TETTO_COMMIT + 1}`, '--stdin'], input);
    const sostituiti = out.split('\n').map((s) => s.trim()).filter((s) => SHA_RE.test(s));
    return { sostituiti: sostituiti.slice(0, TETTO_COMMIT), oltre: sostituiti.length > TETTO_COMMIT };
  } catch (_) {
    return null;
  }
}

/** La modifica di ogni commit (git patch-id), che un rebase senza conflitti conserva. Map sha → id; vuota se git tace. */
export function patchIds(root, shas) {
  const out = new Map();
  if (!shas.length) return out;
  try {
    const diff = git(root, ['diff-tree', '--stdin', '-p', '--root'], `${shas.join('\n')}\n`);
    for (const riga of git(root, ['patch-id', '--stable'], diff).split('\n')) {
      const [id, sha] = riga.trim().split(/\s+/);
      if (id && SHA_RE.test(sha || '')) out.set(sha, id);
    }
  } catch (_) { /* le copie restano fra i commit propri: i sostituiti le coprono lo stesso */ }
  return out;
}

/**
 * Cosa dichiarare di una spinta di `locale` su `ramo`: i commit creati qui; fra questi le copie di un rebase vanno in
 * `riscritti` con l'originale (entrano solo se quello era dichiarato); `sostituiti` i commit visti su origin che la
 * spinta riscrive o toglie. null se non porta niente o git tace (i commit restano di nessuno, cioè buco).
 */
export function spintaDi(root, { locale, remoto = '', ramo }) {
  const propri = commitPropri(root, { locale, remoto, ramo });
  if (!propri) return null;
  const sost = commitSostituiti(root, { locale, remoto, ramo });
  let commits = propri.commits;
  const riscritti = [];
  if (sost && sost.sostituiti.length && commits.length) {
    const originali = new Map();
    for (const [sha, id] of patchIds(root, sost.sostituiti)) if (!originali.has(id)) originali.set(id, sha);
    const ids = patchIds(root, commits);
    commits = commits.filter((c) => {
      const di = originali.get(ids.get(c));
      if (di) riscritti.push({ sha: c, di });
      return !di;
    });
  }
  if (!commits.length && !riscritti.length && !propri.oltre) return null;
  return Object.assign(
    { ramo, punta: locale, commits }, propri.oltre ? { oltre: true } : {}, riscritti.length ? { riscritti } : {},
    sost && sost.sostituiti.length ? { sostituiti: sost.sostituiti } : {}, !sost || sost.oltre ? { sostituitiOltre: true } : {},
  );
}

// Chi ha fatto un commit, annotato dal post-commit e portato sulle copie dal post-rewrite: due sessioni nella stessa
// cartella non si dichiarano a vicenda i commit.
export const AUTORI = 'filo-spinte-autori';
// Un commit mai spinto non tiene la sua annotazione per sempre.
const AUTORE_SCADUTO_MS = 30 * 24 * 60 * 60 * 1000;

function cartellaAutori(root) {
  const coda = cartellaCoda(root);
  return coda ? join(coda, '..', AUTORI) : '';
}

const autoreValido = (v) => (v && v.tipo === 'locale' && typeof v.ticket === 'string' && v.ticket
  ? { tipo: 'locale', ticket: v.ticket, fp: v.fp || '', file: v.file || '' } : null);

/** Le sessioni annotate su `sha` (anche la forma di prima, una sola). [] se nessuna. */
export function autoriDi(root, sha) {
  const dir = cartellaAutori(root);
  if (!dir || !SHA_RE.test(String(sha || ''))) return [];
  try {
    const v = JSON.parse(readFileSync(join(dir, `${sha}.json`), 'utf8'));
    return (Array.isArray(v && v.autori) ? v.autori : [v]).map(autoreValido).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** La prima sessione annotata su `sha`. null se nessuna. */
export function autoreDi(root, sha) {
  return autoriDi(root, sha)[0] || null;
}

function scriviAutori(dir, sha, autori, nowMs) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${sha}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ autori })}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, join(dir, `${sha}.json`));
  try {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n);
      if (nowMs - statSync(f).mtimeMs > AUTORE_SCADUTO_MS) rmSync(f, { force: true });
    }
  } catch (_) { /* si ripulisce al prossimo */ }
}

const conAutori = (prima, nuovi) => {
  const out = prima.slice();
  for (const a of nuovi) if (a && !out.some((x) => x.ticket === a.ticket)) out.push(a);
  return out;
};

/**
 * Il post-commit: annota che `sha` l'ha fatto (anche) la sessione locale `chi`; chi c'era resta. Le routine no: una per
 * copia. → vero se annotato.
 */
export function annotaAutore(root, chi, sha, nowMs = Date.now()) {
  const dir = cartellaAutori(root);
  const a = autoreValido(chi);
  if (!dir || !a || !SHA_RE.test(String(sha || ''))) return false;
  scriviAutori(dir, sha, conAutori(autoriDi(root, sha), [a]), nowMs);
  return true;
}

/**
 * Il post-rewrite (rebase, amend): la copia porta anche gli autori dell'originale, se no la riscrittura la darebbe a chi
 * riscrive (#1362 giro 3 r1). `righe`: «<vecchio> <nuovo>» come le passa git. → quante copie annotate.
 */
export function ereditaAutori(root, righe, nowMs = Date.now()) {
  const dir = cartellaAutori(root);
  if (!dir) return 0;
  let n = 0;
  for (const riga of String(righe || '').split(/\r?\n/)) {
    const [vecchio, nuovo] = riga.trim().split(/\s+/);
    if (!SHA_RE.test(String(vecchio || '')) || !SHA_RE.test(String(nuovo || '')) || vecchio === nuovo) continue;
    const da = autoriDi(root, vecchio);
    if (!da.length) continue;
    scriviAutori(dir, nuovo, conAutori(autoriDi(root, nuovo), da), nowMs);
    n += 1;
  }
  return n;
}

/**
 * Gli autori delle copie fatte senza riscrittura (un cherry-pick): un commit con la stessa modifica di uno che un'altra
 * sessione ha fatto e non è mai partito porta anche i suoi autori. Map sha → autori; vuota se git tace.
 */
function autoriDelleCopie(root, chi, commits) {
  const dir = cartellaAutori(root);
  const out = new Map();
  if (!dir || !commits.length) return out;
  let nomi = [];
  try { nomi = readdirSync(dir).filter((n) => /^[0-9a-f]{40}\.json$/.test(n)).map((n) => n.slice(0, 40)); } catch (_) { return out; }
  const tra = new Set(commits);
  const altrui = new Map();
  for (const s of nomi) {
    if (tra.has(s)) continue;
    const autori = autoriDi(root, s).filter((a) => a.ticket !== chi.ticket);
    if (autori.length) altrui.set(s, autori);
  }
  if (!altrui.size) return out;
  let mai = [];
  try {
    // Un'annotazione di un commit che git ha già buttato non deve spegnere il controllo sugli altri.
    const ci = git(root, ['cat-file', '--batch-check'], `${[...altrui.keys()].join('\n')}\n`).split('\n')
      .map((r) => r.trim().split(/\s+/)).filter(([s, tipo]) => tipo === 'commit' && altrui.has(s)).map(([s]) => s);
    if (!ci.length) return out;
    const visti = new Set(git(root, ['rev-list', '--stdin', '--not', '--remotes'], `${ci.join('\n')}\n`).split('\n').map((x) => x.trim()));
    mai = ci.filter((s) => visti.has(s));
  } catch (_) { return out; }
  if (!mai.length) return out;
  const perId = new Map();
  for (const [sha, id] of patchIds(root, mai)) perId.set(id, conAutori(perId.get(id) || [], altrui.get(sha)));
  for (const [sha, id] of patchIds(root, commits)) if (perId.has(id)) out.set(sha, perId.get(id));
  return out;
}

/**
 * Le spinte divise per chi ha fatto i commit: uno annotato a un'altra sessione va col biglietto di quella, uno senza
 * annotazione con quello di chi spinge. Uno a cui hanno messo mano più sessioni (una copia, un amend) non lo dichiara
 * nessuno, cioè buco: un biglietto pulito non può coprire la parte di un altro, e il no del server a quello dell'altro
 * (chiuso, ramo sbagliato) lascerebbe in piedi solo la dichiarazione pulita. → [{ chi, spinte }], prima chi spinge.
 */
export function perAutore(root, chi, spinte) {
  const gruppi = new Map([[chi.ticket, { chi, spinte: [] }]]);
  const copie = autoriDelleCopie(root, chi, spinte.flatMap((s) => s.commits));
  for (const s of spinte) {
    const altri = new Map();
    const propri = [];
    for (const c of s.commits) {
      const autori = conAutori(autoriDi(root, c), copie.get(c) || []);
      if (autori.length > 1) continue;
      const a = autori[0];
      if (a && a.ticket !== chi.ticket) {
        if (!altri.has(a.ticket)) altri.set(a.ticket, { chi: a, commits: [] });
        altri.get(a.ticket).commits.push(c);
      } else propri.push(c);
    }
    // Le copie di un rebase e i sostituiti restano a chi spinge: la riscrittura è sua.
    if (propri.length || s.oltre || (s.riscritti || []).length || (s.sostituiti || []).length) gruppi.get(chi.ticket).spinte.push(Object.assign({}, s, { commits: propri }));
    for (const [t, a] of altri) {
      if (!gruppi.has(t)) gruppi.set(t, { chi: a.chi, spinte: [] });
      gruppi.get(t).spinte.push({ ramo: s.ramo, commits: a.commits });
    }
  }
  return [...gruppi.values()].filter((x) => x.spinte.length);
}

/** Le spinte di un pre-push di git (righe «<ref locale> <sha> <ref remoto> <sha>») da accodare. PURA a parte git. */
export function spinteDelPrePush(root, righe) {
  const out = [];
  for (const riga of String(righe || '').split(/\r?\n/)) {
    const [, locale, rif, remoto] = riga.trim().split(/\s+/);
    if (!locale || VUOTO.test(locale) || !SHA_RE.test(locale)) continue;
    const m = /^refs\/heads\/(.+)$/.exec(String(rif || ''));
    if (!m || /^(main|master)$/i.test(m[1])) continue;
    // Senza l'elenco la spinta non si dichiara: i suoi commit restano di nessuno, cioè buco al controllo.
    const s = spintaDi(root, { locale, remoto: SHA_RE.test(String(remoto || '')) ? remoto : '', ramo: m[1] });
    if (s) out.push(s);
  }
  return out;
}

/** Quanti sha porta una voce, per i tetti di una chiamata del server. PURA. */
const shaDellaVoce = (v) => ['commits', 'sostituiti', 'riscritti'].reduce((n, k) => n + (Array.isArray(v[k]) ? v[k].length : 0), 0);

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
    const n = shaDellaVoce(v);
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
    Array.isArray(v.sostituiti) && v.sostituiti.length ? { sostituiti: v.sostituiti } : {},
    v.sostituitiOltre === true ? { sostituitiOltre: true } : {},
    Array.isArray(v.riscritti) && v.riscritti.length ? { riscritti: v.riscritti } : {},
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
          // Quelle dopo aspettano con lei: la copia di un rebase passa solo se il suo originale è arrivato prima.
          for (const v of voci) tenute.add(v._file);
          out.errori.push(r.motivo);
          if (r.esito === 'guasto') out.guasto = true;
          break;
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
