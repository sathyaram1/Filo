// Un server finto che risponde come Firestore REST per il documento
// `config/routines`: serve ai test di scripts/verify-local.mjs, che dal
// 2026-09-16 legge i bilanci del giro dal server e senza si ferma.
//
// Gira in un PROCESSO SUO perché i test del CLI lanciano lo script in modo
// sincrono (execFileSync): un server nello stesso processo non risponderebbe
// mai. Uso:
//   node tests/helpers/finto-config-routines.mjs
// stampa `PORT=<n>` su stdout e resta in ascolto finché non viene ucciso.
// I campi li decide l'ambiente: FINTO_CAPS (JSON, es.
// {"cap3":5,"cap2":10,"cap1":1,"cap0":0}); FINTO_STATUS (HTTP di risposta,
// default 200); FINTO_RICHIEDI_BEARER=1 fa rispondere 401 senza l'intestazione
// Authorization.

import { createServer } from 'node:http';

const caps = JSON.parse(process.env.FINTO_CAPS || '{"cap3":5,"cap2":10,"cap1":1,"cap0":0}');
const status = Number(process.env.FINTO_STATUS || 200);
const richiediBearer = process.env.FINTO_RICHIEDI_BEARER === '1';

const fields = {};
for (const [k, v] of Object.entries(caps)) {
  if (typeof v === 'number') fields[k] = { integerValue: String(v) };
  else if (typeof v === 'string') fields[k] = { stringValue: v };
  else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
}

const server = createServer((req, res) => {
  if (richiediBearer && !/^Bearer .+/.test(String(req.headers.authorization || ''))) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Missing bearer' } }));
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(status === 200 ? JSON.stringify({ name: 'projects/finto/databases/(default)/documents/config/routines', fields }) : JSON.stringify({ error: { message: `finto ${status}` } }));
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});
