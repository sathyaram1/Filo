// Voti e riaperture della bacheca col motore vero (#1076): reopenRequests non lo scrive nessun utente, il voto vuole
// un portafoglio attivo e un peso entro 1, la collezione vera non accetta né voti né riaperture da un utente.
// Fuori dalla suite (vuole Java e l'emulatore Firestore). Con l'emulatore sulla 8089 e queste regole, per esempio
// `java -jar cloud-firestore-emulator-*.jar --host 127.0.0.1 --port 8089 --rules firestore.rules`: node <questo file>.
const BASE = 'http://127.0.0.1:' + (process.env.PORTA || '8089') + '/v1/projects/demo-filo/databases/(default)/documents';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ora = Math.floor(Date.now() / 1000);
const token = (uid, extra = {}) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  iss: 'https://securetoken.google.com/demo-filo', aud: 'demo-filo', iat: ora, exp: ora + 3600, auth_time: ora,
  sub: uid, user_id: uid, ...extra,
})}.`;
const anonimo = (uid) => ({ Authorization: `Bearer ${token(uid, { firebase: { sign_in_provider: 'anonymous' } })}` });
const OWNER = { Authorization: 'Bearer owner' };
const ADMIN = { Authorization: `Bearer ${token('u-admin', { email: 'admin@prova.it', email_verified: true, firebase: { sign_in_provider: 'google.com' } })}` };
const str = (v) => ({ stringValue: v });
const mappa = (fields) => ({ mapValue: { fields } });
const voto = (v, cred) => mappa({ vote: str(v), at: str('2026-10-21T10:00:00Z'), credibilitySnapshot: { doubleValue: cred } });

async function richiesta(metodo, percorso, headers, corpo) {
  const r = await fetch(`${BASE}/${percorso}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: corpo ? JSON.stringify(corpo) : undefined });
  return r.status;
}
const chiave = (campo, uid) => `updateMask.fieldPaths=${encodeURIComponent(`${campo}.\`${uid}\``)}`;
const vota = (doc, uid, headers, v, cred) =>
  richiesta('PATCH', `${doc}?${chiave('votes', uid)}`, headers, { fields: { votes: mappa({ [uid]: voto(v, cred) }) } });
const riapri = (doc, uid, headers) =>
  richiesta('PATCH', `${doc}?${chiave('reopenRequests', uid)}`, headers, { fields: { reopenRequests: mappa({ [uid]: mappa({ at: str('2026-10-21T10:00:00Z') }) }) } });

await richiesta('PATCH', 'admins/admin@prova.it', OWNER, { fields: { ok: { booleanValue: true } } });
await richiesta('PATCH', 'feedback/fb', OWNER, { fields: { status: str('done'), statusPublic: str('closed') } });
await richiesta('PATCH', 'feedback-public/fb', OWNER, { fields: { name: str('Titolo'), seq: { integerValue: '7' }, status: str('done'), statusPublic: str('closed') } });
await richiesta('PATCH', 'wallet-accounts/u-con', OWNER, { fields: { pseudonym: str('0123456789abcdef'), keyHash: str('h') } });
await richiesta('PATCH', 'wallet-accounts/u-sospeso', OWNER, { fields: { pseudonym: str('fedcba9876543210'), keyHash: str('h2'), disabled: { booleanValue: true } } });

const casi = [
  ['riapertura scritta da un account anonimo qualunque', await riapri('feedback-public/fb', 'u-anon', anonimo('u-anon')), 403],
  ['riapertura scritta da chi ha un portafoglio (la fa solo il server)', await riapri('feedback-public/fb', 'u-con', anonimo('u-con')), 403],
  ['voto da un account anonimo senza portafoglio', await vota('feedback-public/fb', 'u-anon', anonimo('u-anon'), 'works', 1), 403],
  ['voto da un portafoglio sospeso', await vota('feedback-public/fb', 'u-sospeso', anonimo('u-sospeso'), 'works', 1), 403],
  ['voto col peso 1e9', await vota('feedback-public/fb', 'u-con', anonimo('u-con'), 'broken', 1e9), 403],
  ['voto sulla chiave di un altro', await vota('feedback-public/fb', 'u-anon', anonimo('u-con'), 'broken', 1), 403],
  ['voto da chi ha un portafoglio, peso 1', await vota('feedback-public/fb', 'u-con', anonimo('u-con'), 'works', 1), 200],
  ['il voto si ritira', await richiesta('PATCH', `feedback-public/fb?${chiave('votes', 'u-con')}`, anonimo('u-con'), { fields: {} }), 200],
  ['voto sulla collezione vera', await vota('feedback/fb', 'u-con', anonimo('u-con'), 'works', 1), 403],
  ['riapertura sulla collezione vera', await riapri('feedback/fb', 'u-con', anonimo('u-con')), 403],
  ['l\'owner segna e azzera la riapertura sulla scheda', await riapri('feedback-public/fb', 'u-admin', ADMIN), 200],
  ['l\'owner vota come admin', await vota('feedback-public/fb', 'u-admin', ADMIN, 'works', 1), 200],
];
let rossi = 0;
for (const [nome, avuto, atteso] of casi) {
  const ok = avuto === atteso;
  if (!ok) rossi += 1;
  console.log(`${ok ? 'VERDE' : 'ROSSO'}  ${nome}: ${avuto} (atteso ${atteso})`);
}
process.exit(rossi ? 1 : 0);
