// Scrive nel file generato le chiavi di default dell'installer: prima dal server di sicurezza, poi dai segreti FILO_DEFAULT_* del job; senza nessuna la pubblicazione si ferma.
// L'installer è pubblico e il file ci sta in chiaro: ogni chiave scritta qui la legge chiunque lo scarichi. Quali possono entrarci lo decide l'elenco chiuso di tests/unit/chiaviNelPacchettoPubblico.test.mjs.
// Non stampa mai i valori; i guasti vanno in evidenza col nome della chiave e della fonte (tests/unit/bakeGuastoParlante.test.mjs).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
// Il tetto del testo che il server accetta vive in un posto solo: là sta anche
// la regola che un taglio si dichiara invece di mangiare la parte che contava.
import { testoEntroIlTetto, normalizzaChiavi, parolaDellaCostruzione, DOVE_VA_LA_PAROLA } from './build-alarm.mjs';
import { descriviErroreDiRete } from './lib/rete.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `FILO_BAKE_OUT` esiste SOLO per gli unit test (che scrivono in una cartella
// usa-e-getta invece di calpestare il file vero), come `FILO_UNIT_DIR` per il
// lanciatore dei test: non è un'opzione d'uso, e la CI non la passa mai.
const OUT_PATH = process.env.FILO_BAKE_OUT
  ? resolve(process.env.FILO_BAKE_OUT)
  : resolve(__dirname, '..', 'src', 'main', 'config', 'default-keys.generated.json');

const CANALE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Il motivo del rifiuto arriva sotto nomi diversi a seconda di com'è scritta la
// funzione; un oggetto interpolato diventa «[object Object]» e non spiega niente.
function primaStringa(...valori) {
  for (const v of valori) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// Un solo «fetch failed» su un runner bastava a togliere Linux a una versione uscita (#1240): si copre un disservizio di minuti.
export const ATTESE_S = [5, 15, 30, 60];
// Senza tetto una richiesta appesa terrebbe fermo il lavoro fino al limite di sei ore di GitHub.
export const TETTO_RICHIESTA_MS = 45_000;

/** La rete e il server sovraccarico guariscono aspettando; un rifiuto o un documento senza chiavi no. PURA. */
export function esitoDaRitentare(esito) {
  if (!esito) return false;
  if (esito.stato === 'rete') return true;
  return esito.stato === 'http' && (esito.status >= 500 || esito.status === 429 || esito.status === 408);
}

function descriviErrore(e, tetto) {
  if (e && e.name === 'TimeoutError') return `nessuna risposta in ${Math.ceil(tetto / 1000)} s`;
  return descriviErroreDiRete(e);
}

async function unaRichiesta(passphrase, canale, tetto) {
  try {
    const res = await fetch(`${canale}/buildKeys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
      signal: AbortSignal.timeout(tetto),
    });
    if (!res.ok) return { apiKeys: {}, esito: { stato: 'http', status: res.status } };
    const j = await res.json().catch(() => null);
    if (!j || typeof j !== 'object') return { apiKeys: {}, esito: { stato: 'illeggibile' } };
    // Il rifiuto arriva con HTTP 200 e `ok:false`: finiva in un `{}`
    // indistinguibile da «il documento non ha quella chiave», e non diceva niente.
    if (j.ok === false) {
      return { apiKeys: {}, esito: { stato: 'rifiutato', reason: primaStringa(j.reason, j.error, j.message) } };
    }
    const apiKeys = (j && j.apiKeys && typeof j.apiKeys === 'object') ? { ...j.apiKeys } : {};
    // Fuori dalla mappa `apiKeys`, come nel documento dei segreti: è il contratto del server (#1074).
    const sb = typeof j.safeBrowsingKey === 'string' ? j.safeBrowsingKey.trim() : '';
    if (sb) apiKeys.safeBrowsing = sb;
    const esito = Object.values(apiKeys).some((v) => typeof v === 'string' && v.trim())
      ? { stato: 'ok' }
      : { stato: 'senza-chiavi' };
    return { apiKeys, esito };
  } catch (e) {
    return { apiKeys: {}, esito: { stato: 'rete', messaggio: descriviErrore(e, tetto) } };
  }
}

const attesaVera = (ms) => new Promise((r) => setTimeout(r, ms));

// Ritorna `{ apiKeys, esito }`: le chiavi e PERCHÉ non ci sono, che è quello
// che serve a chi legge il guasto — degradare in silenzio non è degradare.
// Non lancia: si ripiega sui segreti del job, perché una versione con quelle
// chiavi è meglio di nessuna versione. Se non resta niente decide main, e ferma.
export async function chiaviDalServer(passphrase, {
  canale = CANALE, attese = ATTESE_S, tetto = TETTO_RICHIESTA_MS, aspetta = attesaVera, log = console.warn,
} = {}) {
  if (!passphrase) return { apiKeys: {}, esito: { stato: 'passphrase-assente' } };
  const tentativi = attese.length + 1;
  for (let i = 0; ; i++) {
    const r = await unaRichiesta(passphrase, canale, tetto);
    if (esitoDaRitentare(r.esito) && i < attese.length) {
      log(`[bake] ${descriviEsitoServer(r.esito)} Riprovo fra ${attese[i]} s (tentativo ${i + 1} di ${tentativi}).`);
      await aspetta(attese[i] * 1000);
      continue;
    }
    if (esitoDaRitentare(r.esito)) r.esito.tentativi = tentativi;
    if (r.esito.stato === 'ok') {
      if (i > 0) log(`[bake] chiavi dal server al tentativo ${i + 1} di ${tentativi}.`);
    } else {
      log(`[bake] ${descriviEsitoServer(r.esito)} Uso i secret d'ambiente.`);
    }
    return r;
  }
}

function envKey(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

// Le chiavi dei provider che l'applicazione legge dal file generato: il controllo «questa versione ha almeno una
// chiave?» conta queste, e una chiave che nessuno legge gli mentirebbe (tests/unit/bakeChiaviLette.test.mjs).
// Aggiungerne una qui non basta: l'installer è pubblico, e tests/unit/chiaviNelPacchettoPubblico.test.mjs la rifiuta
// finché l'owner non la ammette; lì stanno anche le uscite col loro compito di revoca (OpenRouter #598, Gemini #581).
// `server` è il campo ESATTO del documento dei segreti, perché un guasto dica dove si rimedia (#642); il server
// consegna questi campi e nessun altro, e la sua sentinella legge le righe `server: '…'` di questo file (#1074).
const CHIAVI_DEL_PACCHETTO = [
  { nome: 'tavily', env: 'FILO_DEFAULT_TAVILY_KEY', server: 'config/secrets.apiKeys.tavily' },
];

// Fuori dalla lista sopra perché non è una chiave di provider e la sua assenza
// non ferma la pubblicazione: qui serve solo a spiegarla con le stesse parole.
const FONTE_SAFE_BROWSING = {
  nome: 'safeBrowsing',
  env: 'FILO_DEFAULT_SAFEBROWSING_KEY',
  server: 'config/secrets.safeBrowsingKey',
};

/** Perché il server non ha dato la chiave, in una frase. PURA. */
export function descriviEsitoServer(esito) {
  const e = esito || {};
  const aTutti = e.tentativi > 1 ? `, a tutti i ${e.tentativi} tentativi` : '';
  switch (e.stato) {
    case 'passphrase-assente':
      return 'La costruzione non ha nemmeno interrogato il server: FILO_BUILD_PASSPHRASE è assente dal job.';
    case 'rifiutato':
      return `Il server ha rifiutato la richiesta (ok:false${e.reason ? `, reason: ${e.reason}` : ''}): la parola d'ordine FILO_BUILD_PASSPHRASE è sbagliata, scaduta o revocata. Va ricopiata ${DOVE_VA_LA_PAROLA}.`;
    case 'http':
      return `Il server ha risposto HTTP ${e.status}${aTutti}.`;
    case 'rete':
      return `Il server non era raggiungibile (${e.messaggio || 'motivo ignoto'})${aTutti}.`;
    case 'illeggibile':
      return 'Il server ha risposto qualcosa che non è JSON: non è detto che sia il server giusto.';
    case 'senza-chiavi':
      return 'Il server ha risposto, ma il documento config/secrets non porta nessuna chiave.';
    case 'ok':
      return 'Il server ha risposto, ma senza questa chiave nel documento config/secrets.';
    default:
      return 'Il server non ha dato questa chiave, per un motivo non registrato.';
  }
}

/**
 * Le righe che spiegano quali chiavi mancano, da quali fonti sono state
 * cercate e dove si mettono. PURA: la stessa spiegazione va nel registro della
 * costruzione e nel feedback dell'allarme, e devono dire la stessa cosa.
 */
export function spiegaChiaviMancanti(mancanti, esitoServer) {
  const righe = (mancanti || []).map(
    (c) => `Manca ${c.nome}: né dal server (${c.server}) né dal segreto ${c.env} del job.`
  );
  righe.push(descriviEsitoServer(esitoServer));
  righe.push('Dove si mette: la chiave del server la scrive l\'owner in Gestione → Modelli predefiniti; il segreto di riserva sta nelle impostazioni del repo, Settings → Secrets and variables → Actions.');
  return righe;
}

async function main() {
  const passphrase = parolaDellaCostruzione();
  if (!passphrase) {
    console.warn('[bake] FILO_BUILD_PASSPHRASE assente: uso solo i secret d\'ambiente FILO_DEFAULT_*.');
  }

  const { apiKeys: remote, esito: esitoServer } = await chiaviDalServer(passphrase);

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
  const mancanti = CHIAVI_DEL_PACCHETTO.filter((c) => !apiKeys[c.nome]);

  if (!Object.values(apiKeys).some(Boolean)) {
    const righe = spiegaChiaviMancanti(mancanti, esitoServer);
    // Tutto su una riga: un comando di annotazione spezzato su più righe perde
    // dalla seconda in poi, e con essa il nome della chiave che manca.
    console.error(`::error::La versione uscirebbe senza chiavi di default, la pubblicazione si ferma. ${righe.join(' ')}`);
    // Si prova comunque ad avvisare — ma è un di più: nel caso peggiore (parola
    // d'ordine mancante del tutto) l'allarme non può suonare, perché si apre con
    // quella stessa parola d'ordine. È il motivo per cui serve fermarsi: una
    // pubblicazione che fallisce si vede, una riga rossa in un registro no.
    await avvisa(mancanti, righe, esitoServer);
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

  // Il ripiego sui segreti del job non ferma la pubblicazione, ma vuol dire che
  // una chiave appena cambiata dall'owner NON è arrivata a nessuno: va in evidenza.
  if (esitoServer.stato !== 'ok') {
    console.warn(`::warning::Le chiavi di questa versione non vengono dal server ma dai segreti di riserva del job: una chiave cambiata di recente in Modelli predefiniti non è arrivata agli utenti. ${descriviEsitoServer(esitoServer)}`);
  }

  // Qualcuna c'è, quindi si pubblica — ma una chiave che l'applicazione legge e
  // che nel pacchetto non c'è resterebbe muta all'utente senza dirlo a nessuno.
  if (mancanti.length) {
    console.warn(`::warning::Questa versione esce senza una delle chiavi che l'applicazione legge. ${spiegaChiaviMancanti(mancanti, esitoServer).join(' ')}`);
  }

  // La Safe Browsing assente non ferma la pubblicazione (è un contorno: senza,
  // il primo stadio si salta e restano giudice LLM, sandbox e segnali di rete),
  // ma NON deve sparire in silenzio: da quando il documento dei segreti è
  // admin-only, questa è l'unica strada che porta la chiave agli utenti.
  if (!safeBrowsingKey) {
    console.warn(`::warning::Nessuna chiave Google Safe Browsing: il primo stadio del rilevamento siti pericolosi resterà spento in questa versione. ${spiegaChiaviMancanti([FONTE_SAFE_BROWSING], esitoServer).join(' ')}`);
  }
}

/** Le chiavi dell'allarme: `bake:<nome>` per ogni chiave che manca, `bake` se l'elenco è vuoto. PURA. */
export function chiaviAllarmeBake(mancanti) {
  const chiavi = normalizzaChiavi((mancanti || []).map((c) => `bake:${c?.nome || ''}`).filter((k) => k !== 'bake:'));
  return chiavi.length ? chiavi : ['bake'];
}

/** Col server muto la chiave sul server c'è: «manca la chiave» mandava l'owner a cercarla dove non mancava (#1240). PURA. */
export function titoloAllarmeBake(nomi, esitoServer) {
  if (esitoDaRitentare(esitoServer)) {
    return `Pubblicazione ferma: il server delle chiavi non ha risposto${nomi ? ` e il job non ha la chiave di riserva ${nomi}` : ''}`;
  }
  return nomi ? `Pubblicazione ferma: manca la chiave di default ${nomi}` : 'Pubblicazione ferma: nessuna chiave di default';
}

// Apre un feedback quando la costruzione sta per produrre una versione monca,
// con le STESSE righe del registro: da lì si deve poter agire senza cercare i log.
async function avvisa(mancanti, righe, esitoServer) {
  const passphrase = parolaDellaCostruzione();
  if (!passphrase) {
    console.warn('::warning::Nessun feedback aperto per questa pubblicazione ferma: l\'allarme si apre con FILO_BUILD_PASSPHRASE, che qui manca. Resta solo il guasto qui sopra.');
    return;
  }
  const nomi = (mancanti || []).map((c) => c.nome).join(', ');
  const testo = testoEntroIlTetto([
    'La costruzione non ha trovato nessuna chiave di default e ha fermato la pubblicazione: meglio nessuna versione nuova che una che arriva agli utenti senza niente di preimpostato.',
    '',
    ...(righe || []),
  ].join('\n'));
  try {
    const res = await fetch(`${CANALE}/buildAlarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passphrase,
        name: titoloAllarmeBake(nomi, esitoServer),
        text: testo,
        keys: chiaviAllarmeBake(mancanti),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      console.warn(`::warning::Feedback dell'allarme non consegnato (${res.status}${body.reason ? ` ${body.reason}` : ''}): di questa pubblicazione ferma resta solo il guasto qui sopra.`);
    }
  } catch (e) {
    console.warn(`::warning::Feedback dell'allarme non consegnato (${e.message}): di questa pubblicazione ferma resta solo il guasto qui sopra.`);
  }
}

// La spiegazione del guasto è logica pura e va provata senza scrivere niente:
// l'esecuzione parte solo quando lo script è il comando, non quando è importato.
const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (eseguitoDirettamente) main().catch((e) => {
  // Un errore INATTESO (rete strana, disco pieno) non deve far saltare la
  // pubblicazione: si scrive un file valido e si prosegue. Il caso "nessuna
  // chiave da nessuna fonte" NON passa di qui — lo gestisce main, che si ferma.
  console.warn('[bake] errore non fatale:', e.message);
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    const vuote = Object.fromEntries(CHIAVI_DEL_PACCHETTO.map((c) => [c.nome, '']));
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ apiKeys: vuote, safeBrowsingKey: '', bakedAt: new Date().toISOString() }, null, 2) + '\n',
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
