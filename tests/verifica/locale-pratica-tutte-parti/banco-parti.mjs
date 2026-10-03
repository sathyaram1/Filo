// Banco delle prove del giro 4 (verifica locale pratica-tutte-parti): Firestore finto in memoria, repo git di prova
// con origin, e npm run server:fondi vero con la fusione del server finta. Niente rete, niente Electron.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = join(import.meta.dirname, '..', '..', '..');
const BASE = 'https://firestore.googleapis.com/v1/projects/finto/databases/(default)/documents';

export const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Il repo dell'app di prova: main su origin, più worktree; `lega` scrive il legame di verify-local start --feedback. */
export function repoApp() {
  const dir = cartellaTemporanea('parti-915-');
  const bare = join(dir, 'origin.git');
  mkdirSync(bare);
  sh(bare, 'init', '--bare', '-q', '-b', 'main');
  const wc = join(dir, 'Filo');
  mkdirSync(wc);
  sh(wc, 'init', '-q', '-b', 'main');
  sh(wc, 'config', 'user.email', 'p@p'); sh(wc, 'config', 'user.name', 'p');
  writeFileSync(join(wc, 'base.txt'), 'base\n');
  sh(wc, 'add', '-A'); sh(wc, 'commit', '-q', '-m', 'base');
  sh(wc, 'remote', 'add', 'origin', bare);
  sh(wc, 'push', '-q', '-u', 'origin', 'main');
  let n = 0;
  const commit = (wt, nome) => {
    writeFileSync(join(wt, `f${++n}.txt`), `${n}\n`);
    sh(wt, 'add', '-A'); sh(wt, 'commit', '-q', '-m', `lavoro ${n} su ${nome}`);
  };
  return {
    wc,
    ramo(nome, pratica) {
      const wt = join(dir, nome.replace(/\//g, '-'));
      sh(wc, 'worktree', 'add', '-q', '-b', nome, wt);
      commit(wt, nome);
      mkdirSync(join(wt, '.claude'), { recursive: true });
      writeFileSync(join(wt, '.claude', 'verify-local.json'), JSON.stringify({ [nome]: { feedbackId: pratica } }));
      return wt;
    },
    commit,
    /** La fusione dell'app come la fa il server: un merge su main, pubblicato. */
    fondi(nome) {
      sh(wc, 'merge', '-q', '--no-ff', '-m', `finish: ${nome}`, nome);
      sh(wc, 'push', '-q', 'origin', 'main');
    },
  };
}

/** Firestore finto: GET e PATCH con updateMask anche annidata (localMerges.server), come le chiamate REST dell'app. */
export function firestoreFinto() {
  const docs = {};
  const fetchFinto = async (url, opts = {}) => {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/documents\/feedback\/([^/:]+)$/);
    if (!m) return new Response('{}', { status: 404 });
    const id = decodeURIComponent(m[1]);
    if (String(opts.method || 'GET').toUpperCase() === 'GET') {
      if (!docs[id]) return new Response('{}', { status: 404 });
      return Response.json({ name: `projects/finto/databases/(default)/documents/feedback/${id}`, fields: structuredClone(docs[id]) });
    }
    const corpo = JSON.parse(opts.body || '{}').fields || {};
    const doc = docs[id] || (docs[id] = {});
    for (const p of u.searchParams.getAll('updateMask.fieldPaths')) {
      const [testa, coda] = p.split('.');
      let v = corpo[testa];
      if (coda) v = v?.mapValue?.fields?.[coda];
      if (!coda) { if (v === undefined) delete doc[testa]; else doc[testa] = v; continue; }
      const mappa = doc[testa] || (doc[testa] = { mapValue: { fields: {} } });
      mappa.mapValue.fields = mappa.mapValue.fields || {};
      if (v === undefined) delete mappa.mapValue.fields[coda]; else mappa.mapValue.fields[coda] = v;
    }
    return Response.json({ name: id, fields: doc });
  };
  return { docs, fetchFinto };
}

const s = (v) => ({ stringValue: v });
const i = (v) => ({ integerValue: String(Math.floor(v)) });

/** Una pratica di un lavoro locale: owner, prova del mittente, segno locale. */
export function pratica(docs, id, { status = 'working', parti = null } = {}) {
  docs[id] = {
    seq: i(99915), subSeq: i(0), clientId: s('local:sessione-prova'), senderProof: s('admin'), status: s(status),
    statusPublic: s(status === 'done' ? 'closed' : 'open'), localOnly: { mapValue: { fields: { by: s('owner@prova.it'), at: i(Date.now() - 864e5) } } },
  };
  if (parti) {
    const f = {};
    for (const [k, v] of Object.entries(parti)) f[k] = typeof v === 'number' ? i(v) : s(v);
    docs[id].localMerges = { mapValue: { fields: f } };
  }
}

/** Quello che la fusione dell'app fa oggi sul server quando chiude (closeAfterLocalMerge): done e la parte dell'app. */
export function chiusaDallApp(docs, id, ramo, ora = Date.now()) {
  docs[id].status = s('done');
  docs[id].statusPublic = s('closed');
  const f = (docs[id].localMerges ||= { mapValue: { fields: {} } }).mapValue.fields;
  f.app = i(ora);
  f.ramo = s(ramo);
}

export const stato = (docs, id) => docs[id].status.stringValue;

/** I moduli dell'app, con la cifratura dello stato spenta (il Firestore finto tiene lo stato in chiaro). */
export async function moduli() {
  const of = await import('../../../scripts/owner-feedback.mjs');
  const sf = await import('../../../scripts/server-fondi-pratica.mjs');
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  return { of, sf };
}

/** npm run server:fondi -- <ramo> --feedback <id> [opzioni]: la fusione del server riesce sempre, i rami dell'app sono quelli del repo di prova. */
export async function serverFondi(sf, app, ramo, id, opzioni = []) {
  const righe = [];
  const k = await sf.esegui([ramo, '--feedback', id, ...opzioni], {
    env: {}, bearer: 'finto', base: BASE, funzioni: RADICE, lancia: () => 0, punta: () => 'a'.repeat(40),
    ramiAperti: (pid, o) => sf.ramiApertiDellaPratica(pid, { ...o, radice: app.wc }),
    log: (r) => righe.push(r), err: (r) => righe.push(r),
  });
  return { k, testo: righe.join('\n') };
}
