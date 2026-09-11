// Scrive le chiavi di default nell'eseguibile, a build-time.
//
// COSA FA
//   Prima di ogni build CI, raccoglie le chiavi API di default e le scrive in
//   src/main/config/default-keys.generated.json (gitignorato, finisce SOLO nel
//   binario impacchettato). A runtime default-keys.js legge quel file con
//   precedenza sui valori d'ambiente.
//
//   Questo è il pezzo che fa propagare la rotazione chiavi dell'admin a TUTTI
//   gli utenti, anche quelli senza login: l'admin ruota le chiavi dalla pagina
//   "Modelli predefiniti" (→ Firestore config/secrets); il prossimo build (ogni
//   6h) le rilegge da Firestore e le incastona nel nuovo installer; l'auto-update
//   le consegna a tutti.
//
//   Dal #581 è l'UNICA strada: `config/secrets` è leggibile solo dall'admin, e
//   nessuna installazione lo apre più a runtime. Prima bastava un account Google
//   qualsiasi per scaricarlo per intero con una GET REST.
//
// FONTI DELLE CHIAVI (in ordine di precedenza, per ciascuna chiave):
//   1. il server di sicurezza      → l'override admin più recente, chiesto con
//                                    FILO_BUILD_PASSPHRASE (un segreto che apre
//                                    SOLO questo, e nient'altro)
//   2. env FILO_DEFAULT_*         → secret del job CI (fallback se non c'è override)
//   3. nessuna delle due          → la pubblicazione si FERMA: una versione senza
//                                    chiavi arriva agli utenti muta, e nessuno se
//                                    ne accorgerebbe finché non prova a usarla
//
// SICUREZZA
//   - Lo script NON stampa mai i valori delle chiavi (solo "presente/assente").
//   - Il file generato è gitignorato: non torna mai nel repo pubblico.
//   - Se manca la parola d'ordine si degrada ai secret del job; se manca ANCHE
//     quello, ci si ferma (vedi sopra).
//   - Prima qui c'era il token dell'account ROBOT: una credenziale piena, che
//     apriva le chiavi API a pagamento dell'owner e viveva nell'ambiente — e un
//     ambiente lo eredita chiunque ci passi. Adesso il segreto fa una cosa sola
//     (spec ROUTINE-AUTH-SPEC.md, "un segreto, un potere").

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `FILO_BAKE_OUT` esiste SOLO per gli unit test (che scrivono in una cartella
// usa-e-getta invece di calpestare il file vero), come `FILO_UNIT_DIR` per il
// lanciatore dei test: non è un'opzione d'uso, e la CI non la passa mai.
const OUT_PATH = process.env.FILO_BAKE_OUT
  ? resolve(process.env.FILO_BAKE_OUT)
  : resolve(__dirname, '..', 'src', 'main', 'config', 'default-keys.generated.json');

// Chiede al server le chiavi di default. Ritorna
// { openrouter?, gemini?, tavily?, safeBrowsing? } oppure {} se non disponibili.
// Non lancia: in caso di problemi degrada ai segreti del job, perché una
// versione con quelle chiavi è meglio di nessuna versione. Se non resta nemmeno
// quello, decide main — e si ferma.
const CANALE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// La chiave Safe Browsing sta in `config/secrets` FUORI dalla mappa `apiKeys`
// (campo `safeBrowsingKey`). La risposta del server può quindi portarla in due
// posti a seconda di come la funzione è fatta: accettiamo entrambi invece di
// scommettere su uno solo — sbagliare significherebbe spegnere in silenzio il
// primo stadio del rilevamento siti pericolosi per tutti.
function pickSafeBrowsing(json) {
  if (!json || typeof json !== 'object') return '';
  const candidati = [
    json.safeBrowsingKey,
    json.safeBrowsing,
    json.apiKeys && json.apiKeys.safeBrowsingKey,
    json.apiKeys && json.apiKeys.safeBrowsing,
  ];
  for (const c of candidati) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

async function fetchRemoteKeys(passphrase) {
  if (!passphrase) return {};
  try {
    const res = await fetch(`${CANALE}/buildKeys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      console.warn(`[bake] chiavi dal server non disponibili (${res.status}); uso i secret d'ambiente.`);
      return {};
    }
    const j = await res.json();
    const apiKeys = (j && j.apiKeys && typeof j.apiKeys === 'object') ? { ...j.apiKeys } : {};
    const sb = pickSafeBrowsing(j);
    if (sb) apiKeys.safeBrowsing = sb;
    return apiKeys;
  } catch (e) {
    console.warn(`[bake] server non raggiungibile (${e.message}); uso i secret d'ambiente.`);
    return {};
  }
}

function envKey(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

// Le chiavi dei provider che l'applicazione legge DAVVERO dal file generato,
// cioè quelle che `src/main/config/default-keys.js` va a cercare. Stanno in una
// lista sola, e non sparse in un oggetto scritto a mano, perché il controllo
// «questa versione ha almeno una chiave?» più sotto conta proprio queste: una
// chiave incastonata che nessuno legge non è neutra, mente a quel controllo.
//
// Chi non c'è, e perché.
//   · OpenRouter (#598): ogni utente riceve la sua chiave dal server quando
//     riscatta un invito, col tetto di spesa pari ai suoi crediti. Una chiave
//     di fabbrica nell'installer la apriva a chiunque scaricasse il pacchetto.
//   · Gemini (#581, secondo giro): il collegamento a Gemini in Filo non esiste
//     più e default-keys.js non la legge. Finiva dentro l'installer, che
//     chiunque può scaricare e aprire, senza servire a niente; e siccome il
//     controllo la contava, da sola bastava a far passare una pubblicazione da
//     cui l'applicazione non ricavava nessuna chiave.
// Se un giorno l'applicazione torna a leggere una chiave nuova, va aggiunta
// qui: la sentinella `tests/unit/bakeChiaviLette.test.mjs` diventa rossa se le
// due parti divergono.
const CHIAVI_DEL_PACCHETTO = [
  { nome: 'tavily', env: 'FILO_DEFAULT_TAVILY_KEY' },
];

async function main() {
  const passphrase = process.env.FILO_BUILD_PASSPHRASE;
  if (!passphrase) {
    console.warn('[bake] FILO_BUILD_PASSPHRASE assente: uso solo i secret d\'ambiente FILO_DEFAULT_*.');
  }

  const remote = await fetchRemoteKeys(passphrase);

  const pick = (remoteKey, envName) => {
    const r = typeof remote[remoteKey] === 'string' ? remote[remoteKey].trim() : '';
    return r || envKey(envName);
  };

  const apiKeys = {};
  for (const c of CHIAVI_DEL_PACCHETTO) apiKeys[c.nome] = pick(c.nome, c.env);

  // Chiave Google Safe Browsing (#581). Non è una chiave di modelli, quindi sta
  // fuori da `apiKeys`, ma viaggia per la stessa strada: finché la leggeva a
  // runtime chi era loggato, il documento dei segreti doveva restare aperto a
  // qualunque account Google. Ora la lettura del documento è solo admin e
  // l'unica via verso gli utenti è questa — la stessa che serviva già chi non
  // faceva login, cioè la maggioranza.
  const safeBrowsingKey = pick('safeBrowsing', 'FILO_DEFAULT_SAFEBROWSING_KEY');

  // ⚠️ La domanda "resta qualcosa?" si fa PRIMA di scrivere.
  //
  // Metterla dopo la scrittura lasciava una scappatoia: se la scrittura falliva
  // (disco pieno, permesso negato) si finiva nel ripiego in coda al file, che
  // scrive un file a chiavi VUOTE ed esce contento — cioè proprio la versione
  // muta che questa regola esiste per impedire, e per giunta senza segnalazione.
  // Decidere prima toglie a un guasto di scrittura il potere di riscrivere la
  // risposta.
  //
  // NESSUNA chiave da nessuna fonte non è un degrado accettabile: è una versione
  // che arriva agli utenti senza niente di preimpostato, e nessuno se ne
  // accorgerebbe finché non prova a usarla. Degradare va bene finché resta
  // qualcosa.
  if (!Object.values(apiKeys).some(Boolean)) {
    console.error('::error::Nessuna chiave di default da nessuna fonte: la versione uscirebbe senza chiavi.');
    // Si prova comunque ad avvisare — ma è un di più: nel caso peggiore (parola
    // d'ordine mancante del tutto) l'allarme non può suonare, perché si apre con
    // quella stessa parola d'ordine. È il motivo per cui serve fermarsi: una
    // pubblicazione che fallisce si vede, una riga rossa in un registro no.
    await avvisa();
    process.exit(1);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );

  // Log SENZA valori: solo presenza/assenza, così la CI non espone segreti.
  const summary = Object.fromEntries(
    Object.entries({ ...apiKeys, safeBrowsing: safeBrowsingKey })
      .map(([k, v]) => [k, v ? 'presente' : 'assente'])
  );
  console.log(`[bake] scritto ${OUT_PATH}:`, JSON.stringify(summary));
  // La Safe Browsing assente non ferma la pubblicazione (è un contorno: senza,
  // il primo stadio si salta e restano giudice LLM, sandbox e segnali di rete),
  // ma NON deve sparire in silenzio: da quando il documento dei segreti è
  // admin-only, questa è l'unica strada che porta la chiave agli utenti.
  if (!safeBrowsingKey) {
    console.warn('::warning::Nessuna chiave Google Safe Browsing: il primo stadio del rilevamento siti pericolosi resterà spento in questa versione.');
  }
}

/** Apre un feedback quando la costruzione sta per produrre una versione monca. */
async function avvisa() {
  const passphrase = process.env.FILO_BUILD_PASSPHRASE;
  if (!passphrase) return;
  try {
    await fetch(`${CANALE}/buildAlarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passphrase,
        name: 'Versione costruita senza chiavi di default',
        text: 'La costruzione non ha trovato nessuna chiave di default: né dal server (parola d\'ordine assente, sbagliata o revocata) né fra i segreti del job. La pubblicazione e\' stata fermata: meglio nessuna versione nuova che una che arriva senza chiavi preimpostate. Controlla la parola d\'ordine della costruzione e i segreti di riserva del job.',
      }),
    });
  } catch (_) { /* se non si riesce ad avvisare, resta l'errore nei log */ }
}

main().catch((e) => {
  // Un errore INATTESO (rete strana, disco pieno) non deve far saltare la
  // pubblicazione: si scrive un file valido e si prosegue. Il caso "nessuna
  // chiave da nessuna fonte" NON passa di qui — lo gestisce main, che si ferma.
  console.warn('[bake] errore non fatale:', e.message);
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ apiKeys: { openrouter: '', gemini: '', tavily: '' }, safeBrowsingKey: '', bakedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8'
    );
  } catch (_) {}
  // Dopo il riordino, l'unica cosa che può ancora finire qui è la scrittura del
  // file fallita — e senza quel file la versione arriva agli utenti muta esattamente
  // come se le chiavi non ci fossero, solo per un'altra strada. Ci si ferma:
  // la regola "una versione senza chiavi non esce" non deve avere due esiti a
  // seconda di dove si rompe.
  process.exit(1);
});
