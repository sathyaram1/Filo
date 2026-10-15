// Gli allegati di un feedback anonimo (#597) col motore vero: in `images` e `files` solo oggetti del deposito di Filo.
// Fuori dalla suite (vuole l'emulatore Firestore e Java). Da una cartella con firestore.rules e un firebase.json con
// l'emulatore sulla 8089: firebase emulators:exec --only firestore --project demo-filo "node <questo file>". Uscita 0 = verde.
const BASE = 'http://127.0.0.1:' + (process.env.PORTA || '8089') + '/v1/projects/demo-filo/databases/(default)/documents';
const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const lista = (values) => ({ arrayValue: { values } });
const mappa = (fields) => ({ mapValue: { fields } });

const DEPOSITO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/';
const buono = (n = 0) => `${DEPOSITO}feedback%2F178889149700${n}_3f2a1b0c-1111-4222-8333-44445555666${n}.png?alt=media&token=0b5c3a7e-9d1f-4c2a-8e6b-1a2b3c4d5e6f`;
const ESTERNO = 'https://esempio.invalid/x.png';

async function crea(campi) {
  const r = await fetch(`${BASE}/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { text: str('una segnalazione'), ...campi } }),
  });
  return r.status;
}
const immagini = (urls) => crea({ images: lista(urls.map((u) => (typeof u === 'string' ? str(u) : u))) });
const allegati = (voci) => crea({ files: lista(voci) });
const file = (url) => mappa({ url: str(url), name: str('note.txt'), type: str('text/plain') });

const casi = [
  ['senza allegati', await crea({}), 200],
  ['lista vuota', await immagini([]), 200],
  ['un’immagine del deposito', await immagini([buono()]), 200],
  ['cinque immagini del deposito', await immagini([0, 1, 2, 3, 4].map(buono)), 200],
  ['sei immagini del deposito', await immagini([0, 1, 2, 3, 4, 5].map(buono)), 403],
  ['un URL esterno', await immagini([ESTERNO]), 403],
  ['l’URL esterno all’ultimo posto', await immagini([buono(0), buono(1), buono(2), buono(3), ESTERNO]), 403],
  ['il servizio dei metadati', await immagini(['http://169.254.169.254/computeMetadata/v1/']), 403],
  ['un altro deposito di Google', await immagini([buono().replace('filo-8b9cb.firebasestorage.app', 'estraneo.appspot.com')]), 403],
  ['la risalita verso un altro deposito', await immagini([`${DEPOSITO}feedback%2F..%2F..%2Fb%2Festraneo%2Fo%2Fx.png?alt=media&token=t`]), 403],
  ['un parametro in più', await immagini([`${buono()}&redirect=https://esempio.invalid`]), 403],
  ['un numero al posto dell’URL', await immagini([int(7)]), 403],
  ['una mappa al posto dell’URL', await immagini([mappa({ url: str(buono()) })]), 403],
  ['un documento del deposito', await allegati([file(buono())]), 200],
  ['un documento esterno', await allegati([file(ESTERNO)]), 403],
  ['un documento esterno al quinto posto', await allegati([0, 1, 2, 3].map((n) => file(buono(n))).concat(file(ESTERNO))), 403],
  ['un documento senza URL', await allegati([mappa({ name: str('x') })]), 403],
  ['un documento scritto come stringa', await allegati([str(buono())]), 403],
];
let rossi = 0;
for (const [nome, avuto, atteso] of casi) {
  const ok = avuto === atteso;
  if (!ok) rossi += 1;
  console.log(`${ok ? 'VERDE' : 'ROSSO'}  ${nome}: ${avuto} (atteso ${atteso})`);
}
process.exit(rossi ? 1 : 0);
