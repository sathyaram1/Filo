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

const OUT_PATH = resolve(__dirname, '..', 'src', 'main', 'config', 'default-keys.generated.json');

// Chiede al server le chiavi di default. Ritorna { openrouter?, gemini?, tavily? }
// oppure {} se non disponibili. Non lancia: in caso di problemi degrada ai
// segreti del job, perché una versione con quelle chiavi è meglio di nessuna
// versione. Se non resta nemmeno quello, decide main — e si ferma.
const CANALE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

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
    return (j && j.apiKeys && typeof j.apiKeys === 'object') ? j.apiKeys : {};
  } catch (e) {
    console.warn(`[bake] server non raggiungibile (${e.message}); uso i secret d'ambiente.`);
    return {};
  }
}

function envKey(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

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

  const apiKeys = {
    openrouter: pick('openrouter', 'FILO_DEFAULT_OPENROUTER_KEY'),
    gemini: pick('gemini', 'FILO_DEFAULT_GEMINI_KEY'),
    tavily: pick('tavily', 'FILO_DEFAULT_TAVILY_KEY'),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ apiKeys, bakedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');

  // Log SENZA valori: solo presenza/assenza, così la CI non espone segreti.
  const summary = Object.fromEntries(
    Object.entries(apiKeys).map(([k, v]) => [k, v ? 'presente' : 'assente'])
  );
  console.log(`[bake] scritto ${OUT_PATH}:`, JSON.stringify(summary));

  // NESSUNA chiave da nessuna fonte non è un degrado accettabile: è una
  // versione che arriverà agli utenti senza chiavi di default, e nessuno se ne
  // accorgerebbe finché non prova a usarla. Degradare in silenzio va bene
  // quando resta qualcosa; qui non resta niente, e va detto ad alta voce.
  if (!Object.values(apiKeys).some(Boolean)) {
    console.error('::error::Nessuna chiave di default da nessuna fonte: la versione uscirebbe senza chiavi.');
    await avvisa();
    // E qui ci si FERMA. Degradare andava bene finché restava qualcosa; senza
    // nessuna chiave la versione arriva agli utenti muta — chi la installa non
    // trova niente di preimpostato — e nessuno se ne accorge.
    //
    // Fermarsi è anche l'unica via che regge il caso peggiore: se la parola
    // d'ordine manca DEL TUTTO, l'allarme non può suonare (si apre con quella
    // stessa parola d'ordine). Restava solo una riga rossa in un registro che
    // nessuno guarda. Una pubblicazione che fallisce, invece, si vede.
    process.exit(1);
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
        text: 'La costruzione non ha trovato nessuna chiave di default: né dal server (parola d\'ordine assente, sbagliata o revocata) né fra i segreti del job. La versione esce comunque, ma chi la installa non trova nessuna chiave preimpostata e deve mettere le sue. Controlla la parola d\'ordine della costruzione e i segreti di riserva.',
      }),
    });
  } catch (_) { /* se non si riesce ad avvisare, resta l'errore nei log */ }
}

main().catch((e) => {
  // Un errore INATTESO non deve fermare la pubblicazione (le chiavi vuote sono
  // gestite dentro main, che si ferma da sé): qui si scrive un file valido e si
  // prosegue.
  // Anche in caso di errore inatteso, scriviamo un file vuoto valido così il
  // build non si rompe e l'app parte (chiavi vuote = utente configura le sue).
  console.warn('[bake] errore non fatale:', e.message);
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ apiKeys: { openrouter: '', gemini: '', tavily: '' }, bakedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8'
    );
  } catch (_) {}
  process.exit(0);
});
