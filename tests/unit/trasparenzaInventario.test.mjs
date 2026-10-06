// L'inventario di dove vanno i dati: ogni file nella cartella dei dati, ogni collezione del database del server (anche
// quelle in cui scrive solo il server) e ogni indirizzo esterno nel codice ha la sua frase nel documento sulla privacy
// (#951). Una voce nuova fa rosso finché non entra qui CON la frase; «perche» solo per ciò che non porta dati tuoi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const privacy = leggi('transparency', 'privacy.md').replace(/\s+/g, ' ');

function sorgenti(dir, ext = /\.(js|html|css)$/) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p, ext));
    else if (ext.test(n)) out.push(p);
  }
  return out;
}

// Ogni voce dice dove il documento ne parla; la frase deve esserci, e la voce deve esistere ancora nel codice.
function confronta(trovati, inventario, cosa) {
  const ignoti = [...trovati.keys()].filter((k) => !(k in inventario));
  assert.deepEqual(ignoti, [], `${cosa} senza una riga nel documento sulla privacy: ${ignoti.map((k) => `${k} (${trovati.get(k)})`).join(', ')}`);
  for (const [k, v] of Object.entries(inventario)) {
    assert.ok(trovati.has(k), `${cosa}: «${k}» non c'è più nel codice, togli la voce dall'inventario`);
    if (v.frase) assert.ok(privacy.includes(v.frase), `${cosa}: «${k}» lo racconta «${v.frase}», che il documento non dice più`);
    else assert.ok(v.perche, `${cosa}: «${k}» ha bisogno di una frase nel documento o di un perché`);
  }
}

const CARTELLA_DATI = {
  'storage.json': { frase: 'Tutto quello che Filo sa di te vive nella sua cartella dei dati' },
  'identity.bin': { frase: 'un account anonimo che Filo crea da solo' },
  'wallet.bin': { frase: 'la chiave dei crediti e il tuo accesso Google' },
  'auth.bin': { frase: 'la chiave dei crediti e il tuo accesso Google' },
  'segreti-letti.bin': { frase: 'E per un mese i segreti letti' },
  'archivio-schede': { frase: 'le schede aperte e quelle archiviate' },
  'segnalazioni-mie': { frase: 'una copia delle segnalazioni che hai mandato' },
  filo: { frase: 'le chat, l\'elenco delle richieste fatte ai modelli' },
  quarantena: { frase: 'i download' },
  adblock: { frase: 'le liste per bloccare la pubblicità' },
  'firmatari-c2pa': { frase: 'l\'elenco dei firmatari riconosciuti delle credenziali sulle immagini' },
};

test('ogni file nella cartella dei dati è nel documento sulla privacy', () => {
  const trovati = new Map();
  const base = /^(?:[\w.]*getPath\('userData'\)|root|base|cartellaDati\(\))$/;
  for (const f of sorgenti(join(ROOT, 'src', 'main'), /\.js$/)) {
    const s = readFileSync(f, 'utf8');
    if (!/getPath\('userData'\)|FILO_USER_DATA/.test(s)) continue;
    for (const m of s.matchAll(/path\.join\(\s*([^,]+?)\s*,\s*'([^']+)'/g)) {
      if (base.test(m[1].trim())) trovati.set(m[2], relative(ROOT, f));
    }
  }
  confronta(trovati, CARTELLA_DATI, 'cartella dei dati');
});

// Tutte le collezioni delle regole: quelle che scrive il server tengono dati quanto quelle che scrive l'app (#951,
// quinto giro: il codice dell'installazione in chiaro fra i mittenti). Per quelle che l'app scrive e chiunque legge, anche i campi.
const CONFIGURAZIONE = { perche: 'configurazione del servizio scritta dall\'owner: niente di chi usa l\'app' };
const COLLEZIONI = {
  '/feedback/{doc}': { frase: 'Quando mandi un feedback' },
  '/feedback-public/{doc}': { frase: 'Pubblici sono anche i voti' },
  '/counters/{name}': { perche: 'il numero progressivo dei feedback: quanti ne sono arrivati, niente di chi scrive' },
  '/credits/{uid}': { frase: 'Con il login Google c\'è un secondo documento' },
  '/wallet-usage/{id}': { frase: 'Filo scrive anche un registro d\'uso' },
  '/wallet-accounts/{uid}': { frase: 'tiene un documento con il tuo pseudonimo' },
  '/wallet-invites/{code}': { frase: 'il codice d\'invito con cui sei entrato' },
  '/wallet-state/{doc}': { perche: 'l\'esito dell\'ultimo confronto fra registro d\'uso e consumo di OpenRouter' },
  '/identities/{doc}': { frase: 'nell\'elenco dei mittenti del filtro all\'ingresso' },
  '/attacks/{doc}': { frase: 'con il testo ci sono il codice dell\'installazione, browser e sistema' },
  '/judge-verdicts/{doc}': { perche: 'un registro dei giudizi previsto dalle regole, in cui oggi il server non scrive' },
  '/paths/{domain}': { frase: 'conserva i percorsi dell\'Aiuto' },
  '/entries/{doc}': { frase: 'conserva i percorsi dell\'Aiuto' },
  '/redteam-users/{uid}': { frase: 'Con il tuo account restano il nome in classifica' },
  '/redteam-attempts/{id}': { frase: 'i punteggi e i tentativi' },
  '/redteam-handles/{h}': { frase: 'il nome in classifica, che scegli tu' },
  '/redteam-codes/{code}': { frase: 'Servono il login e un codice' },
  '/config/models': { frase: 'tiene la configurazione condivisa' },
  '/config/secrets': CONFIGURAZIONE,
  '/config/judgeSecrets': CONFIGURAZIONE,
  '/config/automation': CONFIGURAZIONE,
  '/config/routines': CONFIGURAZIONE,
  '/config/redteam': CONFIGURAZIONE,
  '/config/supportModels': CONFIGURAZIONE,
  '/config/credits': CONFIGURAZIONE,
  '/admins/{email}': { perche: 'gli indirizzi di chi amministra il server' },
  '/routines/{email}': { perche: 'le identità delle routine che lavorano i feedback' },
};
const CAMPI_PUBBLICI_SCRITTI = {
  'feedback-public.votes': { frase: 'Pubblici sono anche i voti' },
  'feedback-public.reopenRequests': { frase: 'o chiedi di riaprirla' },
  'feedback-public.vote': { frase: 'con il voto e l\'ora' },
  'feedback-public.at': { frase: 'con il voto e l\'ora' },
  'feedback-public.credibilitySnapshot': { perche: 'un numero uguale per tutti i voti' },
  'counters.value': { perche: 'un intero che conta i feedback' },
};

function blocchiRegole() {
  const src = leggi('firestore.rules').replace(/\/\/[^\n]*/g, '');
  const out = [];
  const re = /match\s+(\/\S+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let d = 1;
    while (d && i < src.length) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
    const proprio = src.slice(re.lastIndex, i - 1).replace(/match\s+\S+\s*\{[\s\S]*$/, '');
    const allow = [...proprio.matchAll(/allow\s+([a-z, ]+):\s*if\s+([\s\S]*?);/g)]
      .map((x) => ({ ops: x[1], cond: x[2].replace(/\s+/g, ' ').trim() }));
    out.push({ path: m[1], allow });
  }
  return out.filter((b) => !b.path.startsWith('/databases'));
}
const soloOwnerOServer = (c) => /^(\(\s*)?(isAdmin\(\)(\s*\|\|\s*isRoutine\(\))?|isRoutine\(\)|false)(\s*\))?(\s*&&|$)/.test(c);

test('ogni collezione del database del server è nel documento sulla privacy, coi campi pubblici scritti dall\'app', () => {
  const collezioni = new Map();
  const campi = new Map();
  for (const b of blocchiRegole()) {
    collezioni.set(b.path, 'firestore.rules');
    const scrive = b.allow.filter((a) => /create|update|write/.test(a.ops) && !soloOwnerOServer(a.cond));
    if (!scrive.length) continue;
    if (!b.allow.some((a) => /read|get|list/.test(a.ops) && a.cond === 'true')) continue;
    const nome = b.path.split('/')[1];
    for (const a of scrive) {
      for (const h of a.cond.matchAll(/hasOnly\(\s*\[([^\]]*)\]/g)) {
        for (const k of h[1].matchAll(/'([A-Za-z]+)'/g)) campi.set(`${nome}.${k[1]}`, 'firestore.rules');
      }
    }
  }
  confronta(collezioni, COLLEZIONI, 'collezione del server');
  confronta(campi, CAMPI_PUBBLICI_SCRITTI, 'campo pubblico scritto dall\'app');
});

const INDIRIZZI = {
  'openrouter.ai': { frase: 'passa da OpenRouter' },
  'europe-west1-filo-8b9cb.cloudfunctions.net': { frase: 'nella regione europe-west1' },
  'firestore.googleapis.com': { frase: 'Filo ha un server, su Firebase' },
  'firebasestorage.googleapis.com': { frase: 'gli screenshot e i file che hai allegato' },
  'identitytoolkit.googleapis.com': { frase: 'un account anonimo che Filo crea da solo' },
  'securetoken.googleapis.com': { frase: 'un account anonimo che Filo crea da solo' },
  'accounts.google.com': { frase: 'L\'accesso Google si apre nel browser' },
  'oauth2.googleapis.com': { frase: 'L\'accesso Google si apre nel browser' },
  'safebrowsing.googleapis.com': { frase: 'Google Safe Browsing.' },
  'rdap.org': { frase: '(rdap.org e crt.sh)' },
  'crt.sh': { frase: '(rdap.org e crt.sh)' },
  'api.tavily.com': { frase: 'Tavily, o DuckDuckGo senza chiave' },
  'html.duckduckgo.com': { frase: 'Tavily, o DuckDuckGo senza chiave' },
  'www.google.com': { frase: 'Il servizio di icone di Google' },
  'lens.google.com': { frase: 'apre Google Lens' },
  'raw.githubusercontent.com': { frase: 'GitHub, EasyList e Fanboy' },
  'easylist.to': { frase: 'GitHub, EasyList e Fanboy' },
  'secure.fanboy.co.nz': { frase: 'GitHub, EasyList e Fanboy' },
  'api.frankfurter.dev': { frase: 'Cambi valuta e carte Magic' },
  'api.scryfall.com': { frase: 'Cambi valuta e carte Magic' },
  'cards.scryfall.io': { frase: 'Cambi valuta e carte Magic' },
  'filo.red': { frase: 'Se apri un link d\'invito sul sito di Filo' },
  'app.tavily.com': { perche: 'un link nelle Opzioni, che apri tu' },
  'scryfall.com': { perche: 'una scheda che apri tu dal tasto destro su una lista del deck builder, con la stessa ricerca che va già ad api.scryfall.com' },
  'filo.local': { perche: 'l\'intestazione con cui OpenRouter sa chi chiama: nessuno lo contatta' },
  'singolarita.com': { perche: 'il contatto scritto nell\'intestazione verso Scryfall: nessuno lo contatta' },
  'filo.app': { perche: 'un esempio in un commento' },
  'llmstxt.org': { perche: 'un riferimento in un commento' },
  'sito.it': { perche: 'un esempio' },
  'www.Gmail.com': { perche: 'un esempio' },
  'www.youtube.com': { perche: 'un esempio in un commento' },
  'paypal.com': { perche: 'un marchio nell\'elenco dei siti imitati dai truffatori' },
  'www.w3.org': { perche: 'lo spazio dei nomi di SVG: nessuno lo contatta' },
  'ns.adobe.com': { perche: 'lo spazio dei nomi dei metadati XMP letti dalle immagini: nessuno lo contatta' },
};

test('ogni indirizzo esterno scritto nel codice è nel documento sulla privacy', () => {
  const trovati = new Map();
  const fuori = /[\\/](transparency|patchNotes)\.js$/;
  for (const f of sorgenti(join(ROOT, 'src'))) {
    if (fuori.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)) {
      if (!trovati.has(m[1])) trovati.set(m[1], relative(ROOT, f));
    }
  }
  confronta(trovati, INDIRIZZI, 'indirizzo esterno');
});
