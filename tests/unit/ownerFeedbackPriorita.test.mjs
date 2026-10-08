// `npm run feedback -- <n> --priorita <0-3>` (#1058): la priorità di un feedback esistente si scrive come il pallino
// di Gestione (cifrata, priorityManual, updatedAt), su ogni stato, e un valore fuori scala non tocca la rete.
// Rete finta: il processo figlio la riceve da un --import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'owner-feedback.mjs');
const mod = await import(pathToFileURL(SCRIPT).href);
const { decryptFeedbackFields } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'decrypt-feedback-fields.mjs')).href);
const apri = await import(pathToFileURL(join(ROOT, 'scripts', 'claude-feedback.mjs')).href);
const lib = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'priorita.mjs')).href);
const C = globalThis.SN_FEEDBACK_CRYPTO;
const FB = globalThis.SN_FEEDBACK;

async function chiaviDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))).toString('base64');
  return { pub, priv };
}
async function conChiavi(fn) {
  const k = await chiaviDiProva();
  const prima = { pub: globalThis.SN_FEEDBACK_PUBKEY, on: globalThis.SN_FEEDBACK_ENC_ENABLED, priv: process.env.FILO_FEEDBACK_PRIVKEY };
  globalThis.SN_FEEDBACK_PUBKEY = k.pub;
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;
  process.env.FILO_FEEDBACK_PRIVKEY = k.priv;
  try { return await fn(k); } finally {
    globalThis.SN_FEEDBACK_PUBKEY = prima.pub;
    globalThis.SN_FEEDBACK_ENC_ENABLED = prima.on;
    if (prima.priv === undefined) delete process.env.FILO_FEEDBACK_PRIVKEY; else process.env.FILO_FEEDBACK_PRIVKEY = prima.priv;
  }
}

function documento(campi) {
  return { name: 'projects/p/databases/(default)/documents/feedback/fid', fields: campi };
}
async function conRete(doc, fn) {
  const chiamate = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    const u = new URL(String(url));
    chiamate.push({ metodo, url: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (metodo !== 'GET') return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    if (!doc) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const m = u.searchParams.getAll('mask.fieldPaths');
    const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
    return { ok: true, status: 200, json: async () => ({ name: doc.name, fields }), text: async () => '' };
  };
  try { return await fn(chiamate); } finally { globalThis.fetch = vero; }
}
const scritture = (chiamate) => chiamate.filter((c) => c.metodo !== 'GET');
const maschera = (c) => c.url.searchParams.getAll('updateMask.fieldPaths');
const OPTS = { bearer: 'tok-finto' };
const RICEVUTI = documento({ status: { stringValue: 'design' }, statusPublic: { stringValue: 'open' }, priority: { integerValue: '1' } });

test('la priorità a riga di comando: solo una cifra della scala, il resto si rifiuta col motivo', () => {
  for (const v of ['0', '1', '2', '3', 3, ' 2 ']) assert.equal(mod.prioritaDaScrivere(v).ok, true, `«${v}» è della scala`);
  for (const v of ['4', '-1', 'alta', '1.5', '3.0', '0x3', ' ', '', undefined, null, 'true']) {
    const r = mod.prioritaDaScrivere(v);
    assert.equal(r.ok, false, `«${v}» doveva essere rifiutata`);
    assert.match(r.motivo, /0, 1, 2, 3/, 'il motivo dice cosa è ammesso');
  }
  // La regola è una sola: quella che apre un feedback rifiuta le stesse cose.
  assert.equal(apri.parsePriorita(' ').ok, false, 'uno spazio non è la priorità 0');
  assert.equal(apri.parsePriorita, lib.parsePriorita);
});

test('un valore fuori scala non tocca la rete, né da solo né con uno stato', async () => {
  await conRete(RICEVUTI, async (chiamate) => {
    for (const v of ['5', '-1', 'alta', '']) {
      const r = await mod.scriviPriorita('fid', v, OPTS);
      assert.equal(r.ok, false);
      assert.match(r.motivo, /ammessi 0, 1, 2, 3/);
      const s = await mod.scrivi('fid', 'todo', 'nota', { ...OPTS, priorita: v });
      assert.equal(s.ok, false);
      assert.match(s.motivo, /ammessi 0, 1, 2, 3/);
    }
    assert.deepEqual(chiamate, [], 'nessuna lettura e nessuna scrittura');
  });
});

test('--priorita da sola scrive i campi del pallino di Gestione, cifrati allo stesso modo', async () => {
  await conChiavi(async ({ priv }) => {
    let nostra;
    await conRete(RICEVUTI, async (chiamate) => {
      const r = await mod.scriviPriorita('fid', '3', OPTS);
      assert.equal(r.ok, true, r.motivo);
      assert.equal(r.a, 3);
      assert.equal(r.prima, 1, 'dice da dove si parte');
      [nostra] = scritture(chiamate);
    });
    let gestione;
    await conRete(RICEVUTI, async (chiamate) => {
      await FB.updateStatus('fid', { priority: 3, priorityManual: true }, { idToken: 'tok' });
      [gestione] = scritture(chiamate);
    });
    assert.ok(nostra && gestione, 'una scrittura per parte');
    assert.deepEqual([...maschera(nostra)].sort(), [...maschera(gestione)].sort(), 'stessi campi del pallino');
    assert.deepEqual([...maschera(nostra)].sort(), ['priority', 'priorityManual', 'updatedAt']);
    const f = nostra.body.fields;
    assert.match(f.priority.stringValue, /^FENC1:/, 'cifrata: il documento è pubblico');
    assert.equal((await decryptFeedbackFields({ _id: 'fid', priority: f.priority.stringValue }, priv)).priority, 3);
    assert.equal((await decryptFeedbackFields({ _id: 'fid', priority: gestione.body.fields.priority.stringValue }, priv)).priority, 3);
    assert.deepEqual(f.priorityManual, { booleanValue: true }, 'decisa a mano: il giudice non la riabbassa');
    assert.ok(f.updatedAt && f.updatedAt.timestampValue, 'con l’ora dell’ultima modifica');
  });
});

test('nei Ricevuti, e in ogni altro stato, la priorità cambia e la pratica resta dov’è', async () => {
  for (const stato of ['design', 'unlabeled', 'todo', 'done', 'archived', 'attack_confirmed']) {
    const doc = documento({ status: { stringValue: stato }, statusPublic: { stringValue: 'open' } });
    await conRete(doc, async (chiamate) => {
      const r = await mod.scriviPriorita('fid', 0, OPTS);
      assert.equal(r.ok, true, `${stato}: ${r.motivo}`);
      assert.equal(r.prima, null, 'senza priorità prima, niente «era»');
      const [w] = scritture(chiamate);
      assert.ok(w, `${stato}: scritta`);
      assert.equal(maschera(w).some((m) => /^status/.test(m)), false, `${stato}: lo stato non si tocca`);
    });
  }
});

test('un feedback che non c’è non si crea: solo la lettura, nessuna scrittura', async () => {
  await conRete(null, async (chiamate) => {
    const r = await mod.scriviPriorita('manca', '2', OPTS);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /inesistente/);
    assert.deepEqual(scritture(chiamate), []);
  });
});

test('senza la cifratura la priorità non si scrive in chiaro: rifiuto prima della rete', async () => {
  const on = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  try {
    await conRete(RICEVUTI, async (chiamate) => {
      const r = await mod.scriviPriorita('fid', '2', OPTS);
      assert.equal(r.ok, false);
      assert.match(r.motivo, /chiave|cifra/);
      assert.deepEqual(chiamate, []);
    });
  } finally { globalThis.SN_FEEDBACK_ENC_ENABLED = on; }
});

test('la prova a vuoto legge e non scrive, e il messaggio elenca i campi coi valori', async () => {
  await conRete(RICEVUTI, async (chiamate) => {
    const r = await mod.scriviPriorita('fid', '3', { ...OPTS, dryRun: true });
    assert.equal(r.ok, true);
    assert.deepEqual(scritture(chiamate), []);
    const riga = mod.messaggioPriorita('#903', r);
    assert.match(riga, /prova a vuoto/);
    assert.match(riga, /priorità 3, era 1/);
    assert.match(riga, /priority \(3, cifrata\), priorityManual \(true, decisa a mano\), updatedAt/);
  });
  assert.match(mod.messaggioPriorita('#903', { a: 3, prima: 3 }), /era già 3/);
  assert.match(mod.messaggioPriorita('#903', { a: 2, prima: null }), /^OK: #903 a priorità 2\. Decisa a mano/);
});

test('con un cambio di stato la priorità viaggia nella stessa scrittura', async () => {
  const sessione = documento({ clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' }, status: { stringValue: 'todo' }, statusPublic: { stringValue: 'open' } });
  await conChiavi(async ({ priv }) => {
    await conRete(sessione, async (chiamate) => {
      const r = await mod.scrivi('fid', 'archived', 'non serve più', { ...OPTS, priorita: '2' });
      assert.equal(r.ok, true, r.motivo);
      const [w] = scritture(chiamate);
      const m = maschera(w);
      for (const c of ['status', 'priority', 'priorityManual', 'updatedAt']) assert.ok(m.includes(c), `${c} in ${m.join(',')}`);
      assert.equal((await decryptFeedbackFields({ _id: 'fid', priority: w.body.fields.priority.stringValue }, priv)).priority, 2);
      assert.equal(w.body.fields.priorityManual.booleanValue, true);
    });
  });
});

// ─── La riga di comando, col processo vero ───────────────────────────────────

function reteFinta(dir) {
  const registro = join(dir, 'scritture.jsonl');
  const finto = join(dir, 'rete.mjs');
  writeFileSync(finto, `
import { appendFileSync } from 'node:fs';
const doc = ${JSON.stringify(RICEVUTI)};
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (!/firestore/.test(u.hostname)) return new Response(JSON.stringify({ id_token: 'finto', expires_in: '3600' }), { status: 200 });
  if (u.pathname.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: doc.name, fields: { subSeq: { integerValue: '0' } } } }]), { status: 200 });
  if ((opts.method || 'GET') !== 'GET') { appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ url: String(url), body: JSON.parse(opts.body) }) + '\\n'); return new Response('{}', { status: 200 }); }
  const m = u.searchParams.getAll('mask.fieldPaths');
  const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
  return new Response(JSON.stringify({ name: doc.name, fields }), { status: 200 });
};`);
  const lancia = (args, env = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(finto).href, SCRIPT, ...args], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '', ...env },
  });
  const scritte = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []);
  return { lancia, scritte };
}

test('riga di comando: `<n> --priorita 3 --dry-run` stampa i campi e non scrive; senza, scrive', () => {
  const { lancia, scritte } = reteFinta(cartellaTemporanea('priorita-1058-'));
  const vuoto = lancia(['#1058', '--priorita', '3', '--dry-run']);
  assert.equal(vuoto.status, 0, vuoto.stderr);
  assert.match(vuoto.stdout, /\(prova a vuoto\) #1058: priorità 3, era 1; stato invariato\. Campi che scriverei: priority \(3, cifrata\), priorityManual \(true, decisa a mano\), updatedAt \(adesso\)/);
  assert.deepEqual(scritte(), []);

  const vero = lancia(['1058', '--priorita=2']);
  assert.equal(vero.status, 0, vero.stderr);
  assert.match(vero.stdout, /OK: 1058 a priorità 2, era 1\. Decisa a mano/);
  const [w] = scritte();
  assert.match(w.url, /\/feedback\/fid\?/);
  assert.match(w.body.fields.priority.stringValue, /^FENC1:/);
  assert.equal(w.body.fields.priorityManual.booleanValue, true);
  assert.deepEqual(new URL(w.url).searchParams.getAll('updateMask.fieldPaths').sort(), ['priority', 'priorityManual', 'updatedAt']);
});

test('riga di comando: valori sbagliati e accoppiate che la perderebbero si rifiutano prima delle credenziali', () => {
  const { lancia, scritte } = reteFinta(cartellaTemporanea('priorita-1058-'));
  const senzaCredenziali = { FILO_ADMIN_REFRESH_TOKEN: '' };
  for (const v of ['5', '-1', 'alta', '']) {
    const r = lancia(['fid', '--priorita', v], senzaCredenziali);
    assert.equal(r.status, 1, `«${v}»`);
    assert.match(r.stderr, /RIFIUTATO: .*0, 1, 2, 3 — non ho toccato niente/, `«${v}»: ${r.stderr}`);
  }
  for (const altre of [['--frase', 'ciao'], ['--preapprova'], ['--solo-locale'], ['--come-routine']]) {
    const r = lancia(['fid', '--priorita', '3', ...altre], senzaCredenziali);
    assert.equal(r.status, 1, altre.join(' '));
    assert.match(r.stderr, /--priorita senza stato va da sola/, r.stderr);
  }
  const serve = lancia(['fid', '--serve-locale', 'perché', '--priorita', '3'], senzaCredenziali);
  assert.equal(serve.status, 1);
  assert.match(serve.stderr, /--priorita non va con --serve-locale/);
  assert.deepEqual(scritte(), []);
});

test('riga di comando: --priorita mangiata da npm si riprende dall’ambiente; l’aiuto la nomina', () => {
  const { lancia } = reteFinta(cartellaTemporanea('priorita-1058-'));
  const r = lancia(['fid', '--dry-run'], { npm_config_priorita: '3' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /priorità 3/);
  const aiuto = lancia(['--help']);
  assert.match(aiuto.stderr, /--priorita <0-3>.*solo la priorità/);
});

test('riga di comando: due priorità nello stesso comando si rifiutano e non scrivono', () => {
  const { lancia, scritte } = reteFinta(cartellaTemporanea('priorita-1058-'));
  const r = lancia(['1058', '--priorita', '3', '--priorita', '1']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /--priorita è scritta più di una volta/);
  assert.deepEqual(scritte(), []);
});

test('claude-feedback: se la priorità non nasce col documento, l\'uscita dà il comando per metterla', async () => {
  const FB = globalThis.SN_FEEDBACK;
  apri.credenziale.ottieni = async () => ({ idToken: 'tok-finto' });
  apri.ambiente.routine = () => false;
  const orig = { submit: FB.submit, log: console.log };
  const righe = [];
  FB.submit = async () => ({ id: 'doc1', seq: 4321, senderProof: '' });
  console.log = (...a) => righe.push(a.join(' '));
  try { await apri.main(['titolo', 'testo', '--locale', '--priorita', '3']); } finally { FB.submit = orig.submit; console.log = orig.log; }
  assert.match(righe.join('\n'), /Priorità 3 NON impostata: mettila con npm run feedback -- 4321 --priorita 3/);
});
