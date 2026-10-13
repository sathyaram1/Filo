// Verifica locale «fiducia» (#1148), giro 12: la regola transitoria di server:fondi (aggiunta del 13/10).
// r1: senza il campo fiducia passa solo il mittente provato. r2: il rifiuto di una pratica non fidata dice la strada vera.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'fiduciaRamo.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}

const s = (v) => ({ stringValue: v });
const segno = { mapValue: { fields: { by: s('owner'), at: { integerValue: '1' } } } };
const pratica = (extra) => ({
  clientId: s('owner:prova'), senderProof: s('admin'), status: s('working'), statusPublic: s('open'),
  localOnly: segno, seq: { integerValue: '4242' }, ...extra,
});

// server:fondi su un Firestore finto: nessuna rete vera, lo strumento del server non parte mai davvero.
async function fondi(doc) {
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!/firestore\.googleapis\.com|finto\.invalid/.test(u)) throw new Error(`rete vera vietata: ${u}`);
    const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
    const nome = 'projects/p/databases/(default)/documents/feedback/FB1';
    if (u.includes(':runQuery')) return json([{ document: { name: nome, fields: { seq: { integerValue: '4242' } } } }]);
    return json({ name: nome, fields: doc });
  };
  const lanci = [];
  const err = [];
  try {
    const mod = await import(pathToFileURL(join(RADICE, 'scripts', 'server-fondi-pratica.mjs')).href);
    const k = await mod.esegui(['claude/prova-fiducia', '--feedback', '4242', '--dry-run'], {
      env: {}, log: () => {}, err: (m) => err.push(String(m)), bearer: 'finto', base: 'https://finto.invalid/v1/x/documents',
      funzioni: join(RADICE, 'non-esiste'),
      verdetto: () => ({ ok: true, reason: 'verifica finta', server: { sha: 'a'.repeat(40) } }),
      fissa: (c, r) => ({ ok: true, ramo: `${r}-verificato-x`, togli: () => ({ ok: true }) }),
      lancia: (c, args) => { lanci.push(args); return 0; },
      ramiAperti: () => [], punta: () => 'a'.repeat(40),
    });
    return { k, lanciato: lanci.length > 0, err: err.join('\n') };
  } finally {
    globalThis.fetch = vero;
  }
}

test('r1 server:fondi: una pratica senza il campo fiducia passa solo col mittente provato, non il feedback di un utente approvato come lavoro locale', async () => {
  const provato = await fondi(pratica({}));
  expect(provato.lanciato, 'mittente provato, campo assente: la regola di prima').toBe(true);
  const utente = await fondi(pratica({ clientId: s('abc123'), senderProof: s(''), localApproval: segno }));
  expect(utente.lanciato, 'un utente approvato come lavoro locale non ha il mittente provato, e dopo la migrazione sarà non fidato').toBe(false);
});

test('r1 la fusione dell\'app, a campo assente, salta L5 solo col mittente provato', async () => {
  const SRV = funzioniDelServer();
  expect(SRV, 'funzioni del server accanto al repo').not.toBe('');
  const { decisioneL5Legacy } = createRequire(import.meta.url)(join(SRV, 'src', 'fiduciaRamo.js'));
  const base = { senderProof: 'admin', clientId: 'owner:prova', status: 'working', localOnly: { by: 'owner', at: 1 } };
  expect(decisioneL5Legacy({ feedback: base, via: 'locale' }).locale.eligible).toBe(true);
  const utente = { ...base, clientId: 'abc123', senderProof: '', localApproval: { by: 'owner', at: 1 } };
  expect(decisioneL5Legacy({ feedback: utente, via: 'locale' }).locale.eligible, 'utente approvato senza campo fiducia').toBe(false);
});

test('r2 server:fondi su una pratica dell\'owner non fidata: il rifiuto dice Segna fidato in Gestione e non propone una strada che non sblocca il server', async () => {
  const r = await fondi(pratica({ fiducia: s('non_fidato') }));
  expect(r.lanciato).toBe(false);
  expect(r.err, 'la strada vera: la fiducia la dà l’owner in Gestione').toMatch(/Segna fidato/);
  expect(r.err, 'approvarla come lavoro locale non la rende fidata, e server:fondi la rifiuta lo stesso').not.toMatch(/approvalo come lavoro locale/);
});
