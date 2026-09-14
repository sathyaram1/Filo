// Verifica #583, giro 9 — le PORTE del deposito, contate col motore vero.
//
// NON è uno spec: come il file gemello del giro 8 il nome finisce in `.mjs` e
// non in `.spec.mjs`, così la suite non prova a lanciarlo (vuole l'emulatore
// ufficiale di Storage e Java, che nella suite non ci sono e non ci devono
// essere).
//
// PERCHÉ, DOPO IL GIRO 8
//   Il giro 8 ha chiuso una porta sola: lo scarico del singolo file. Sullo
//   stesso deposito, con la stessa unica chiave in mano (l'indirizzo, che è
//   stato pubblico per mesi dentro i documenti dei feedback), le porte sono
//   quattro. Questo file le prova tutte insieme, così la prossima correzione
//   non le chiude una per giro.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu-storage && cd /tmp/emu-storage && npm init -y
//   npm i firebase-tools
//   cp <repo>/storage.rules .
//   cp <repo>/tests/verifica/583/giro9-deposito-porte-col-motore-vero.mjs prova.mjs
//   cat > firebase.json <<'FINE'
//   { "storage": { "rules": "storage.rules" },
//     "emulators": { "storage": { "port": 9199, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only storage --project filo-prova-583 "node prova.mjs"
//
// ESITO AL GIRO 9 (2026-09-14), quattro porte:
//
//   metadati col solo indirizzo      403  chiusa dal giro 8 (dentro c'è il codice:
//                                         se si leggessero, il `get` negato non varrebbe niente)
//   cancellare l'allegato di un altro 403 chiusa, ma per caso: la regola di scrittura
//                                         guarda `request.resource.size`, che su una
//                                         cancellazione non c'è, e l'errore di valutazione
//                                         vale come rifiuto. Chiusa è chiusa; regge su un
//                                         inciampo, non su una condizione scritta.
//   riscrivere l'allegato di un altro 200 APERTA — difetto noto, messo da parte dal server
//                                         e aperto come feedback a sé (giro 8).
//   l'allegato del tester dopo la riscrittura: NON è più raggiungibile nemmeno col
//                                         suo link originale. Il caricamento sopra
//                                         rilascia un codice NUOVO, quindi il vecchio
//                                         link risponde 403.
//
// LA CORREZIONE DI CIÒ CHE ERA SCRITTO
//   Il giro 8 aveva descritto la porta aperta come una sostituzione silenziosa
//   («chi la guarda in dashboard vede il file nuovo e non ha modo di sapere che
//   è cambiata»). Col `get` chiuso non è più così, e conviene saperlo prima di
//   scrivere il feedback a parte: la riscrittura RUOTA il codice di scarico,
//   quindi il link che sta dentro il feedback muore. Chi lavora la segnalazione
//   non vede la fotografia di un estraneo: vede un buco, con scritto che
//   l'immagine non è disponibile. Lo screenshot del tester è perso comunque —
//   distrutto invece che sostituito.

const BUCKET = 'filo-prova-583.appspot.com';
const BASE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`;

let rotte = 0;
function riga(etichetta, atteso, ottenuto, extra = '') {
  const ok = atteso === ottenuto;
  if (!ok) rotte += 1;
  console.log(`${ok ? 'ok  ' : 'ROTT'} ${String(ottenuto).padEnd(5)} ${etichetta}`
    + `${extra ? `  ${extra}` : ''}${ok ? '' : `  (atteso ${atteso})`}`);
}

async function carica(nome, tipo, corpo) {
  const r = await fetch(`${BASE}?name=${encodeURIComponent(nome)}`, {
    method: 'POST', headers: { 'Content-Type': tipo }, body: Buffer.from(corpo),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, codice: j.downloadTokens || (j.metadata && j.metadata.downloadTokens) || '' };
}

const nome = 'feedback/1700000000001_allegato-di-un-tester.jpg';
const enc = encodeURIComponent(nome);

const primo = await carica(nome, 'image/jpeg', 'FOTO-DEL-TESTER');
riga('un tester carica il suo allegato', 200, primo.status);

// 1. I metadati portano il codice di scarico: leggerli equivale ad avere la
//    chiave, e il `get` negato non servirebbe a niente.
riga('metadati col solo indirizzo', 403, (await fetch(`${BASE}/${enc}`)).status);

// 2. In queste regole `write` copre creare, riscrivere E cancellare.
riga('cancellare l\'allegato di un altro', 403, (await fetch(`${BASE}/${enc}`, { method: 'DELETE' })).status);

// 3. Riscrivere: la porta nota, lasciata aperta apposta fuori da questo giro.
const sopra = await carica(nome, 'image/jpeg', 'FOTO-DI-UN-ESTRANEO');
console.log(`${sopra.status === 200 ? 'noto' : 'ok  '} ${String(sopra.status).padEnd(5)} `
  + 'riscrivere l\'allegato di un altro (difetto noto, feedback a parte)');

// 4. Dopo la riscrittura, il link che sta dentro il feedback apre ancora?
const dopo = await fetch(`${BASE}/${enc}?alt=media&token=${primo.codice}`);
console.log(`${dopo.status === 200 ? '    ' : 'noto'} ${String(dopo.status).padEnd(5)} `
  + 'il link originale del tester dopo la riscrittura'
  + (dopo.status === 200 ? `  (${(await dopo.text())})` : '  (il codice è stato ruotato: l\'allegato è perso, non sostituito)'));

console.log(rotte ? `\n${rotte} porte che dovevano essere chiuse non lo sono.` : '\nLe porte che il giro 8 ha chiuso sono chiuse.');
process.exit(rotte ? 1 : 0);
