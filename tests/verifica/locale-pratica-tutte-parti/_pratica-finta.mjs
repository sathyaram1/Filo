// Firestore finto (fetch globale) e server:fondi con git e fusione finti, per le prove del giro #915. Non è una prova.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });

export async function preparaPratiche() {
  const of = await imp('scripts/owner-feedback.mjs');
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  const { FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  const { esegui } = await imp('scripts/server-fondi-pratica.mjs');
  const DB = new Map();
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(String(url).replace('(default)', 'DEFAULT'));
    const id = decodeURIComponent(u.pathname.split('/').pop());
    const d = DB.get(id);
    if ((opt.method || 'GET') === 'GET') return d ? json(d) : json({}, 404);
    if (!d) return json({}, 404);
    const body = JSON.parse(opt.body);
    for (const p of u.searchParams.getAll('updateMask.fieldPaths')) {
      const [a, b] = p.split('.');
      if (b) {
        d.fields[a] = d.fields[a] || { mapValue: { fields: {} } };
        const src = body.fields?.[a]?.mapValue?.fields?.[b];
        if (src) d.fields[a].mapValue.fields[b] = src; else delete d.fields[a].mapValue.fields[b];
      } else if (body.fields && a in body.fields) d.fields[a] = body.fields[a]; else delete d.fields[a];
    }
    return json(d);
  };
  const nuova = (id, { status = 'working', merges = null } = {}) => {
    const fields = {
      clientId: S('owner:prova'), senderProof: S('admin'), status: S(status), notes: S(''),
      localOnly: { mapValue: { fields: { by: S('owner'), at: I(1) } } },
    };
    if (merges) fields.localMerges = { mapValue: { fields: Object.fromEntries(Object.entries(merges).map(([k, v]) => [k, typeof v === 'number' ? I(v) : S(v)])) } };
    DB.set(id, { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields });
  };
  const stato = (id) => {
    const f = DB.get(id).fields;
    return { status: f.status.stringValue, merges: f.localMerges?.mapValue?.fields || {}, notes: f.notes?.stringValue || '' };
  };
  const fondi = async (argv, { ramiAperti = [] } = {}) => {
    const righe = [];
    const fusioni = [];
    const k = await esegui(argv, {
      env: {}, log: (s) => righe.push(s), err: (s) => righe.push(s), bearer: 'finto', base: FIRESTORE_BASE, funzioni: 'finta',
      lancia: (_c, a) => { fusioni.push(a.join(' ')); return 0; }, ramiAperti: () => ramiAperti, punta: () => 'abcdef0123456789',
    });
    return { k, testo: righe.join('\n'), fusioni };
  };
  return { nuova, stato, fondi };
}

/** La cartella functions del server da provare: quella del ramo con lo stesso nome, se c'è; '' se manca. */
export function functionsDelServer() {
  if (process.env.FILO_SECURITY_FUNCTIONS) return process.env.FILO_SECURITY_FUNCTIONS;
  let ramo = '';
  try { ramo = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { /* staccato */ }
  let d = ROOT;
  for (let i = 0; i < 8; i += 1) {
    const sec = join(dirname(d), 'filo-security');
    const gemello = join(sec, '.claude', 'worktrees', ramo.replace(/^claude\//, ''), 'functions');
    if (ramo && existsSync(join(gemello, 'src', 'routine', 'ownerMerge.js'))) return gemello;
    if (existsSync(join(sec, 'functions', 'src', 'routine', 'ownerMerge.js'))) return join(sec, 'functions');
    if (dirname(d) === d) break;
    d = dirname(d);
  }
  return '';
}

export const richiediServer = (cartella) => createRequire(join(cartella, 'index.js'));
