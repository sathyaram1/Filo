// L'approvazione dell'owner come lavoro locale (#913, `localApproval`) col motore vero: solo l'admin la scrive.
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
const ROUTINE = { Authorization: `Bearer ${token('routine@prova.it')}` };
const UTENTE = { Authorization: `Bearer ${token('utente@prova.it')}` };
const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const mappa = (fields) => ({ mapValue: { fields } });
const SI = mappa({ by: str('admin@prova.it'), at: int(1759400000000) });

async function richiesta(metodo, percorso, headers, corpo) {
  const r = await fetch(`${BASE}/${percorso}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: corpo ? JSON.stringify(corpo) : undefined });
  return r.status;
}
const patch = (id, campi, headers, fields) =>
  richiesta('PATCH', `feedback/${id}?${campi.map((c) => `updateMask.fieldPaths=${c}`).join('&')}`, headers, { fields });

await richiesta('PATCH', 'admins/admin@prova.it', OWNER, { fields: { ok: { booleanValue: true } } });
await richiesta('PATCH', 'routines/routine@prova.it', OWNER, { fields: { ok: { booleanValue: true } } });
for (const id of ['utente', 'approvato']) {
  await richiesta('PATCH', `feedback/${id}`, OWNER, { fields: { status: str('design'), statusPublic: str('open'), clientId: str('utente-7'), text: str('x') } });
}
await richiesta('PATCH', 'feedback/approvato?updateMask.fieldPaths=localApproval', OWNER, { fields: { localApproval: SI } });

const anonimo = { text: str('serve in locale'), clientId: str('utente-7'), localApproval: SI };
const casi = [
  ['un utente anonimo crea un feedback già approvato', await richiesta('POST', 'feedback', {}, { fields: anonimo }), 403],
  ['un utente anonimo si dà l’approvazione', await patch('utente', ['localApproval'], {}, { localApproval: SI }), 403],
  ['un utente loggato si dà l’approvazione', await patch('utente', ['localApproval'], UTENTE, { localApproval: SI }), 403],
  ['un utente loggato la mette insieme a un voto', await patch('utente', ['votes', 'localApproval'], UTENTE,
    { votes: mappa({ 'u-utente@prova.it': mappa({ vote: str('up'), at: str('2026-10-02T10:00:00Z') }) }), localApproval: SI }), 403],
  ['una routine se la dà', await patch('utente', ['status', 'localApproval'], ROUTINE, { status: str('todo'), localApproval: SI }), 403],
  ['una routine la toglie', await patch('approvato', ['localApproval'], ROUTINE, {}), 403],
  ['l’admin approva (segno, sì e stato insieme)', await patch('utente', ['status', 'localOnly', 'localApproval'], ADMIN,
    { status: str('todo'), localOnly: SI, localApproval: SI }), 200],
  ['l’admin con la firma vuota', await patch('approvato', ['localApproval'], ADMIN, { localApproval: mappa({ by: str(''), at: int(1) }) }), 403],
  ['l’admin con l’ora in testo', await patch('approvato', ['localApproval'], ADMIN, { localApproval: mappa({ by: str('a'), at: str('ieri') }) }), 403],
  ['l’admin con un campo in più', await patch('approvato', ['localApproval'], ADMIN, { localApproval: mappa({ by: str('a'), at: int(1), testo: str('x') }) }), 403],
  ['l’admin la toglie', await patch('approvato', ['localApproval'], ADMIN, {}), 200],
  ['l’admin crea un feedback già approvato', await richiesta('PATCH', 'feedback/nuovo', ADMIN, { fields: { text: str('x'), localApproval: SI } }), 200],
];
let rossi = 0;
for (const [nome, avuto, atteso] of casi) {
  const ok = avuto === atteso;
  if (!ok) rossi += 1;
  console.log(`${ok ? 'VERDE' : 'ROSSO'}  ${nome}: ${avuto} (atteso ${atteso})`);
}
process.exit(rossi ? 1 : 0);
