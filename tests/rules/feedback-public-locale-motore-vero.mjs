// La scheda pubblica di un lavoro locale (#908) col motore vero: rifiutata, quella normale no, la delete sempre.
// Fuori dalla suite (vuole l'emulatore Firestore e Java). Da una cartella con firestore.rules e un firebase.json con
// l'emulatore sulla 8089: firebase emulators:exec --only firestore --project demo-filo "node <questo file>". Uscita 0 = verde.
const BASE = 'http://127.0.0.1:' + (process.env.PORTA || '8089') + '/v1/projects/demo-filo/databases/(default)/documents';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ora = Math.floor(Date.now() / 1000);
const token = (email) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  iss: 'https://securetoken.google.com/demo-filo', aud: 'demo-filo', iat: ora, exp: ora + 3600, auth_time: ora,
  sub: 'u-' + email, user_id: 'u-' + email, email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
})}.`;
const OWNER = { Authorization: 'Bearer owner' };
const ADMIN = { Authorization: `Bearer ${token('admin@prova.it')}` };
const str = (v) => ({ stringValue: v });

async function richiesta(metodo, percorso, headers, corpo) {
  const r = await fetch(`${BASE}/${percorso}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: corpo ? JSON.stringify(corpo) : undefined });
  return r.status;
}

const scheda = { fields: { name: str('Titolo'), seq: { integerValue: '7' }, status: str('done'), statusPublic: str('closed') } };
await richiesta('PATCH', 'admins/admin@prova.it', OWNER, { fields: { ok: { booleanValue: true } } });
await richiesta('PATCH', 'feedback/locale', OWNER, { fields: { status: str('done'), localOnly: { mapValue: { fields: { by: str('local:claude'), at: { integerValue: '1' } } } } } });
await richiesta('PATCH', 'feedback/normale', OWNER, { fields: { status: str('done') } });
await richiesta('PATCH', 'feedback-public/esistente', OWNER, scheda);
await richiesta('PATCH', 'feedback/esistente', OWNER, { fields: { status: str('done'), localOnly: { mapValue: { fields: { by: str('a@b.it'), at: { integerValue: '2' } } } } } });

const casi = [
  ['crea la scheda di un lavoro locale', await richiesta('PATCH', 'feedback-public/locale', ADMIN, scheda), 403],
  ['aggiorna la scheda già pubblicata di un lavoro locale', await richiesta('PATCH', 'feedback-public/esistente?updateMask.fieldPaths=name', ADMIN, { fields: { name: str('Nuovo') } }), 403],
  ['crea la scheda di un feedback normale', await richiesta('PATCH', 'feedback-public/normale', ADMIN, scheda), 200],
  ['toglie la scheda di un lavoro locale', await richiesta('DELETE', 'feedback-public/esistente', ADMIN), 200],
  ['crea una scheda senza feedback vero', await richiesta('PATCH', 'feedback-public/fantasma', ADMIN, scheda), 403],
];
let rossi = 0;
for (const [nome, avuto, atteso] of casi) {
  const ok = avuto === atteso;
  if (!ok) rossi += 1;
  console.log(`${ok ? 'VERDE' : 'ROSSO'}  ${nome}: ${avuto} (atteso ${atteso})`);
}
process.exit(rossi ? 1 : 0);
