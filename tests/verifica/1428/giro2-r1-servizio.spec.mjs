// Verifica #1428 giro 2: da un terminale senza biglietto, le note di servizio scritte dagli strumenti su una pratica
// fidata e chiusa (archiviazione a punteggio, ultima parte di server:fondi) devono andare a buon fine. Rete finta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

function praticaChiusaFidata() {
  return {
    name: 'projects/p/databases/(default)/documents/feedback/f1',
    fields: {
      seq: { integerValue: '553' }, subSeq: { integerValue: '0' }, clientId: { stringValue: 'local:claude' },
      senderProof: { stringValue: 'admin' }, status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' },
      notes: { stringValue: '' }, fiducia: { stringValue: 'fidato' },
    },
  };
}

async function conRete(doc, of, fn) {
  const MR = globalThis.SN_MANAGE_REVIEW;
  const veri = { ...of.sessione };
  of.sessione.biglietto = async () => null;
  of.sessione.togliFiducia = async () => {
    const c = MR.fiduciaTogliCheck({ fiducia: doc.fields.fiducia.stringValue, statusPublic: doc.fields.statusPublic.stringValue });
    if (!c.ok) return { ok: false, motivo: c.motivo };
    doc.fields.fiducia = { stringValue: 'non_fidato' };
    return { ok: true };
  };
  const vero = globalThis.fetch;
  const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
  const rt = process.env.FILO_ADMIN_REFRESH_TOKEN;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'rt-finto';
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (/token|oauth/i.test(u)) return new Response(JSON.stringify({ id_token: 'tok', access_token: 'tok', expires_in: '3600' }), { status: 200 });
    if ((init.method || 'GET') === 'PATCH') {
      Object.assign(doc.fields, JSON.parse(init.body).fields);
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  try { return await fn(); } finally {
    globalThis.fetch = vero;
    globalThis.SN_FEEDBACK_ENC_ENABLED = cifra;
    if (rt === undefined) delete process.env.FILO_ADMIN_REFRESH_TOKEN; else process.env.FILO_ADMIN_REFRESH_TOKEN = rt;
    Object.assign(of.sessione, veri);
  }
}

test('r1 l’archiviazione a punteggio da un terminale senza biglietto archivia una pratica fidata chiusa', async () => {
  const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  require(join(ROOT, 'src', 'shared', 'boardArchive.js'));
  const FB = globalThis.SN_FEEDBACK;
  const { runAutoArchive } = await import(pathToFileURL(join(ROOT, 'scripts', 'auto-archive.mjs')).href);
  const ORA = Date.parse('2026-09-20T12:00:00Z');
  const VECCHIO = new Date(ORA - 5 * 24 * 3600_000).toISOString();
  const voti = { a: { vote: 'works', at: VECCHIO, weight: 3 }, b: { vote: 'works', at: VECCHIO, weight: 3 } };
  const doc = praticaChiusaFidata();
  const vere = { list: FB.list, listPublic: FB.listPublic, listAllPaged: FB.listAllPaged, listAllPublic: FB.listAllPublic };
  FB.listAllPaged = undefined;
  FB.listAllPublic = undefined;
  FB.list = async (o) => (o.afterName ? [] : [{ _id: 'f1', status: 'done', resolvedAt: VECCHIO, resolvedInVersion: '1.0.0', seq: 553, subSeq: 0, fiducia: 'fidato', votes: voti }]);
  FB.listPublic = async () => [];
  const avvisi = [];
  const warn = console.warn;
  const log = console.log;
  console.warn = (...a) => avvisi.push(a.join(' '));
  console.log = () => {};
  let r;
  try {
    r = await conRete(doc, of, () => runAutoArchive({ now: ORA, releasedVersion: '1.0.0', usaCopia: false, copiaDir: cartellaTemporanea('verifica-1428-') }));
  } finally {
    console.warn = warn;
    console.log = log;
    Object.assign(FB, vere);
  }
  expect(r.toArchive.map((x) => x.id)).toEqual(['f1']);
  expect(avvisi.filter((a) => /non archiviato/.test(a)).join('\n')).toBe('');
  expect(doc.fields.status.stringValue).toBe('archived');
});

test('r1 server:fondi con l’ultima parte di una pratica fidata già chiusa, senza biglietto: la nota di fine si scrive', async () => {
  const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  const doc = praticaChiusaFidata();
  const nota = 'claude/x è su main del server (abc1234). Era l’ultima parte: la pratica l’aveva chiusa la fusione della parte dell’app, e resta chiusa.';
  const r = await conRete(doc, of, () => of.scrivi('f1', 'done', nota, { bearer: 'tok', attore: 'routine', avviso: () => {} }));
  expect(r.motivo || '').toBe('');
  expect(r.ok).toBe(true);
  expect(doc.fields.notes.stringValue).toMatch(/Era l’ultima parte/);
});
