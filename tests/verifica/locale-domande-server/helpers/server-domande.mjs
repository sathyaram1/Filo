// Verifica locale «domande-server» (#1149): il codice VERO del server (domande, canale, consegne) su un Firestore in
// memoria, con una chiave dell'owner fatta qui. Niente rete, niente Electron.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

export const RADICE = join(import.meta.dirname, '..', '..', '..', '..');

function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'domande', 'index.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}

export const SRV = funzioniDelServer();
const require = createRequire(join(SRV || RADICE, 'index.js'));
const req = (p) => require(join(SRV, p));
const b64url = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Una chiave per processo: chi cifra la priorità tiene la funzione che ha trovato al primo caricamento.
let chiavi = null;
async function chiaveOwner() {
  if (chiavi) return chiavi;
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  chiavi = {
    pub: b64url(new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey))),
    priv: Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey))).toString('base64'),
  };
  return chiavi;
}

export async function server(seed = {}) {
  const { pub, priv } = await chiaveOwner();
  process.env.FILO_FEEDBACK_PRIVKEY = priv;
  const crypto = req('src/feedbackCrypto');
  if (!crypto.__veraCifra) {
    crypto.__veraCifra = crypto.encryptForOwner;
    crypto.encryptForOwner = (t) => crypto.__veraCifra(t, pub);
  }
  const { memFirestore } = req('test/fixtures/firestore-mem');
  const mem = memFirestore(seed);
  const fsMod = req('src/data/firestore');
  // Canale, consegne e coda tengono la funzione db che trovano al primo caricamento: la si fa passare da qui.
  if (!fsMod.__perVerifica) { fsMod.db = () => globalThis.__dbVerificaDomande(); fsMod.__perVerifica = true; }
  globalThis.__dbVerificaDomande = () => mem();
  const S = {
    mem,
    /** Sostituisce il Firestore che vede il server (per osservarne le scritture); senza argomento torna a mem. */
    usaDb: (fabbrica) => { globalThis.__dbVerificaDomande = fabbrica || (() => mem()); },
    domande: req('src/domande'),
    archivio: req('src/domande/archivio'),
    deliver: req('src/routine/deliver'),
    payload: req('src/routine/payload'),
    policy: req('src/routine/policy'),
    secrets: req('src/routine/secrets'),
    sm: req('src/routine/stateMachine'),
    enc: (s) => crypto.encryptForOwner(String(s)),
    dec: async (v) => (crypto.isEncrypted(v) ? crypto.decrypt(v, priv) : v),
  };
  return S;
}

/** Un feedback con stato, priorità e note cifrati come quelli veri. */
export async function feedback(S, id, { seq, status, reason = '', fiducia = 'fidato', priority = 2 }) {
  await S.mem().doc(`feedback/${id}`).set({
    seq, subSeq: 0, status: await S.enc(S.sm.padForCipher(status)), statusPublic: S.sm.publicOf(status),
    statusReason: reason, fiducia, priority: await S.enc(String(priority)), notes: '',
  });
}

/** Con che fiducia nascerebbe ADESSO il biglietto di chi riprende quel feedback (chiave a rete limitata, feedback fidato). */
export function nascitaDelProssimo(S, feedbackId) {
  return S.policy.ticketTrustAtBirth({
    role: 'fixer', feedback: { fiducia: 'fidato' }, state: S.mem.doc(`routine-state/${feedbackId}`) || null,
    key: { data: { rete: 'limitata' } },
  });
}
