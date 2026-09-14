// Verifica #583, giro 8 — le regole del DEPOSITO provate col motore vero.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo. Per girare vuole due cose che nella suite non
// ci sono e non ci devono essere: l'emulatore ufficiale di Storage (un .jar) e
// Java. La sentinella sempre accesa è
// tests/unit/firestoreRulesFeedbackRead.test.mjs, che rilegge il file in
// millisecondi; questo è l'altra metà, la prova che quel file dato in pasto al
// motore vero si comporta come dice.
//
// PERCHÉ SERVIVA DAVVERO, QUI
//   La correzione del giro 8 nega il `get` sugli allegati. Chiuderlo alla cieca
//   sarebbe stato un azzardo: l'unica cosa che tiene in piedi la dashboard è
//   che Firebase valuti il codice di scarico del link PRIMA delle regole. Se
//   non fosse così, le immagini dei feedback si spegnerebbero tutte insieme
//   sulla macchina di chi li lavora, e nessuna prova del repo diventerebbe
//   rossa. Questo file è la controprova, ed è verde.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu-storage && cd /tmp/emu-storage && npm init -y
//   npm i firebase-tools
//   cp <repo>/storage.rules .
//   cp <repo>/tests/verifica/583/giro8-deposito-col-motore-vero.mjs prova.mjs
//   cat > firebase.json <<'FINE'
//   { "storage": { "rules": "storage.rules" },
//     "emulators": { "storage": { "port": 9199, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only storage --project filo-prova-583 "node prova.mjs"
//
// ESITO AL GIRO 8 (2026-09-14): sette righe su sette come previsto, uscita 0.
//
//   caricamento anonimo di un allegato        200  (un feedback si manda senza login)
//   scarico col SOLO indirizzo                403  ← la porta che il giro 8 ha chiuso
//   scarico col link intero, come fa il main  200  ← la dashboard continua a vedere
//   scarico con codice sbagliato              403
//   elenco del deposito                       403
//   caricamento fuori dalla cartella feedback 403
//   caricamento di un tipo attivo (html)      403
//
// CONTROPROVA fatta insieme: le stesse chiamate con `allow get: if true` (com'era
// prima della correzione), dove il solo indirizzo tornava il file e anche un
// codice sbagliato tornava 200 — il codice non lo guardava nessuno. Una prova
// che passa su entrambe le versioni non prova niente.

const BUCKET = 'filo-prova-583.appspot.com';
const BASE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`;

let rotte = 0;
function riga(etichetta, atteso, ottenuto, extra = '') {
  const ok = atteso === ottenuto;
  if (!ok) rotte += 1;
  console.log(`${ok ? 'ok  ' : 'ROTT'} ${String(ottenuto).padEnd(4)} ${etichetta}`
    + `${extra ? `  ${extra}` : ''}${ok ? '' : `  (atteso ${atteso})`}`);
}

const nome = 'feedback/1700000000000_aaaa-bbbb-cccc.jpg';
const enc = encodeURIComponent(nome);

// 1. Caricare resta anonimo: un feedback si manda senza login, e gli allegati
//    partono con lui. Questa riga NON deve mai diventare 403.
const up = await fetch(`${BASE}?name=${enc}`, {
  method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('FAKEJPEG'),
});
riga('caricamento anonimo di un allegato', 200, up.status);
const meta = await up.json().catch(() => ({}));
const codice = meta.downloadTokens || (meta.metadata && meta.metadata.downloadTokens) || '';
riga('il deposito rilascia il codice di scarico', true, !!codice);

// 2. Il solo indirizzo non apre più niente. È la porta del giro 8: gli
//    indirizzi degli allegati stavano dentro i documenti dei feedback, che per
//    mesi si sono letti senza credenziali.
riga('scarico col SOLO indirizzo', 403, (await fetch(`${BASE}/${enc}?alt=media`)).status);

// 3. Il link intero sì: è quello che il main di chi lavora i feedback usa per
//    scaricare e decifrare. Senza questa riga verde la correzione spegne le
//    immagini in dashboard.
const conCodice = await fetch(`${BASE}/${enc}?alt=media&token=${codice}`);
riga('scarico col link intero, come fa il main', 200, conCodice.status,
  conCodice.status === 200 ? `(${(await conCodice.text()).length} byte)` : '');

// 4. E il codice conta davvero: sbagliarlo è come non averlo. È ciò che rende
//    di nuovo revocabile un link scappato.
riga('scarico con codice sbagliato', 403,
  (await fetch(`${BASE}/${enc}?alt=media&token=00000000-0000-0000-0000-000000000000`)).status);

// 5. L'elenco resta chiuso (giro 8 non l'ha toccato, ma se si riaprisse il
//    resto varrebbe la metà: si pescherebbero i nomi e poi i file).
riga('elenco del deposito', 403, (await fetch(`${BASE}?prefix=feedback%2F&maxResults=5`)).status);

// 6. Il deposito è solo per gli allegati dei feedback, e solo per tipi passivi.
riga('caricamento fuori dalla cartella dei feedback', 403,
  (await fetch(`${BASE}?name=${encodeURIComponent('altro/x.jpg')}`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('X'),
  })).status);
riga('caricamento di un tipo attivo (html)', 403,
  (await fetch(`${BASE}?name=${enc}`, {
    method: 'POST', headers: { 'Content-Type': 'text/html' }, body: Buffer.from('<script>'),
  })).status);

console.log(rotte ? `\n${rotte} righe rotte.` : '\nTutto come previsto.');
process.exit(rotte ? 1 : 0);
