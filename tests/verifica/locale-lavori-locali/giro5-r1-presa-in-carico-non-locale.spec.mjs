// Verifica locale «lavori locali», giro 5, rilievo 1: la presa in carico all'avvio della verifica porta «In lavorazione»
// anche una pratica dell'owner senza segno locale, e il server (stall, dal checkout di filo-security) la ridà alle routine.
// Rete finta; `start --feedback` simulato con le sue due chiamate (se la cura sta altrove, la prova la segue).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

function stallDelServer() {
  const comune = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const p = join(process.env.FILO_SECURITY_DIR || join(dirname(dirname(comune)), 'filo-security'), 'functions', 'src', 'routine', 'stall.js');
  return existsSync(p) ? createRequire(import.meta.url)(p) : null;
}

test('una pratica dell’owner legata a un lavoro locale non torna in coda alle routine mentre la sessione la lavora', async () => {
  const stall = stallDelServer();
  test.skip(!stall, 'serve il checkout di filo-security accanto al repo');
  const OF = await imp('scripts/owner-feedback.mjs');
  const doc = {
    name: 'projects/x/databases/(default)/documents/feedback/own-1',
    fields: {
      clientId: { stringValue: 'owner:sathya' }, status: { stringValue: 'todo' },
      senderProof: { stringValue: 'admin' }, statusPublic: { stringValue: 'open' },
    },
  };
  const scritte = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'PATCH') { scritte.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    return String(url).includes('/feedback/own-1') ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try {
    // Come fa `verify-local start --feedback <N>`: prima se la sessione la può lavorare, poi la nota del giro.
    const lavorabile = await OF.praticaPerLaSessione('own-1', { bearer: 't' });
    if (!lavorabile.ok) return; // rifiutata prima di toccarla: la porta è chiusa
    const a = await OF.annotaPratica('own-1', 'Verifica locale, giro 1: avviata sul ramo claude/prova (abcdef12).', { bearer: 't' });
    expect(a.ok, a.motivo).toBe(true);
    const campi = Object.assign({}, ...scritte.map((s) => s.body.fields));
    const pratica = {
      _id: 'own-1', status: a.to, workingSince: campi.workingSince?.stringValue || '',
      ...(campi.localOnly?.mapValue ? { localOnly: { by: 'local:claude', at: Date.now() } } : {}),
    };
    // La sessione lavora (verifica, correzioni): un giro dura più di un'ora.
    const dopo = Date.parse(pratica.workingSince || new Date().toISOString()) + 90 * 60 * 1000;
    const d = stall.decideStall(pratica, null, false, dopo);
    expect(d.stalled, `il server la rimette in «${d.to}» (${d.why}): una routine la prende mentre la sessione la lavora`).toBe(false);
  } finally {
    globalThis.fetch = vero;
  }
});
