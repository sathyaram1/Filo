// I percorsi condivisi (`paths`) sono l'unico contenuto di Filo scritto da un
// utente e LETTO nel prompt di un altro: chi li avvelena non colpisce sé stesso
// ma chi visiterà quel dominio. Qui sta il trattamento, dalle due parti:
//
//   • in SCRITTURA — `sanitizeSubmission()` è la pulizia deterministica che
//     decide cosa può entrare nella raccolta: forma del dominio, una riga sola
//     di intento, selettori redatti e tagliati, azioni note, tetto ai passi.
//     La applica il client PRIMA di inviare e la RIAPPLICA il server prima di
//     scrivere (le regole Firestore non lasciano più scrivere nessun client:
//     vedi firestore.rules → match /paths). Sta qui, in `src/shared/`, perché
//     è il posto da cui il backend di sicurezza incorpora i moduli condivisi al
//     deploy: una copia a mano dall'altra parte divergerebbe in silenzio.
//
//   • in LETTURA — `formatKnownPathsForPrompt()` impacchetta i percorsi fra due
//     marcature, chiedendo la busta a SN_ESTERNO (`src/shared/contenutoEsterno.js`),
//     che dal #593 è la porta unica di tutto ciò che entra in un prompt venendo
//     da fuori, e li ripulisce di nuovo. La seconda pulizia non è un doppione:
//     nella raccolta restano i documenti scritti quando chiunque poteva
//     scriverli, e un percorso inviato in buona fede può comunque contenere il
//     testo di una pagina ostile. Il prompt (`SN_CONST.PROMPTS.helpContext`)
//     dichiara quel blocco contenuto esterno, e il promemoria finale lo cita
//     insieme a pagina, outline e llms.txt.

(function (global) {
  'use strict';

  // Stessi numeri dei vincoli in firestore.rules: se cambiano qui vanno cambiati là (e
  // viceversa), o una scrittura passerebbe un controllo e non l'altro.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_INTENT_LEN = 200;
  const MAX_DOMAIN_LEN = 253;
  const MAX_URL_LEN = 2000;

  const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;
  // Tetto per UN percorso solo: senza, uno lungo si mangia quasi tutto il resto e sulla
  // stessa pagina gli altri non arrivano più al modello.
  const MAX_PATH_CHARS = Math.floor(KNOWN_PATHS_BUDGET_CHARS / 4);

  // Il tipo di contenuto esterno sotto cui i percorsi entrano nel prompt. La
  // busta — le due righe che delimitano il blocco, e la pulizia che impedisce
  // al contenuto di scriversele da sé — la fa SN_ESTERNO
  // (src/shared/contenutoEsterno.js), che è la porta unica di tutto ciò che
  // arriva da fuori (#593).
  //
  // Si prende al momento dell'uso, non al caricamento, e per un motivo
  // preciso: questo file viene INCORPORATO nel backend di sicurezza al deploy
  // (predeploy `bake-shared`), dove gira da solo e dove serve la sola
  // scrittura (`sanitizeSubmission`). La lettura — l'unica parte che imbusta —
  // là non viene mai chiamata. Un `require` in testa spegnerebbe il deploy per
  // una funzione che il server non usa.
  const TIPO_ESTERNO = 'PERCORSI_CONDIVISI';

  function esterno() {
    if (!global.SN_ESTERNO && typeof require === 'function') {
      require('./contenutoEsterno.js');
    }
    if (!global.SN_ESTERNO) {
      throw new Error('SN_ESTERNO mancante: carica shared/contenutoEsterno.js prima di pathsSafety.js');
    }
    return global.SN_ESTERNO;
  }

  const LONG_NUM_RE = /\b\d{6,}\b/g;
  // IBAN e codice fiscale hanno lettere in mezzo: la regola delle cifre attaccate non li
  // vedeva e uscivano interi in una raccolta che legge chiunque.
  const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
  const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
  // Cifre separate da spazi, punti o trattini: «333 123 456». Chi sostituisce le conta e
  // passa solo da sei cifre in su, così «riga 2 di 3» resta com'è e un telefono no.
  const NUM_SPEZZATO_RE = /\d[\d \u00A0.\-/]{3,}\d/g;
  // Il soprannome con la chiocciola usciva intero nelle etichette (#584). Il `@` deve aprire
  // la parola, così un nome di classe CSS con la chiocciola protetta resta quello che è.
  const SOPRANNOME_RE = /(^|[\s"'])@[A-Za-z0-9._-]{2,40}/g;
  const AZIONI = ['click', 'fill', 'reveal', 'hover'];

  // Un dominio è un hostname: niente spazi, a capo o slash, cioè niente frasi travestite da
  // dominio.
  const DOMINIO_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  // Il nome del sito non si può ripulire (è l'indirizzo Firestore): o esce com'è o non esce.
  // Per router, NAS, localhost, intranet e reti anonime il nome dice dove lavori: non esce.
  const SUFFISSI_PRIVATI = new Set([
    'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'arpa',
    // nomi riservati: non sono e non saranno mai su Internet
    'localhost', 'test', 'invalid', 'example',
    // reti anonime
    'onion', 'alt', 'i2p',
  ]);
  const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

  // Un host può finire con un punto: `localhost.` è `localhost`, ma l'ultimo pezzo è vuoto.
  // Si toglie ovunque, anche in lettura (paths.js), o le due strade userebbero due cartelle.
  function normalizzaHost(hostname) {
    let h = String(hostname == null ? '' : hostname).trim().toLowerCase();
    while (h.endsWith('.')) h = h.slice(0, -1);
    return h;
  }

  function sitoCondivisibile(hostname) {
    const h = normalizzaHost(hostname);
    if (!h) return false;
    // Un indirizzo IPv6 arriva fra parentesi quadre da `new URL`.
    if (h.startsWith('[') || h.includes(':')) return false;
    if (IPV4_RE.test(h)) return false;
    // Una parola sola non è un sito pubblico: `localhost`, `nas`, `router`, e l'host delle
    // pagine interne di Filo.
    if (!h.includes('.')) return false;
    const ultimo = h.slice(h.lastIndexOf('.') + 1);
    if (SUFFISSI_PRIVATI.has(ultimo)) return false;
    return true;
  }

  // Caratteri invisibili (larghezza zero, direzione, i «tag» U+E0000, selettori di variante):
  // con quelli un'etichetta nasconde una frase diretta ai modelli; stessa lista in SN_CONST.
  const INVISIBILI_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff]|[\u{E0000}-\u{E007F}]/gu;

  // Toglie tutto ciò che, dentro un testo che finirà nel prompt, servirebbe
  // solo a fingere di essere la struttura del prompt: caratteri di controllo,
  // a capo (ogni campo è una riga sola), sequenze di < o > che imiterebbero le
  // marcature, e il nome delle marcature stesse.
  //
  // Questa è la pulizia in SCRITTURA, e gira anche sul server, dove SN_ESTERNO
  // non c'è: resta quindi autonoma. Non conosce i nomi delle buste degli altri
  // tipi, e non le serve — schiacciando ogni coppia di parentesi angolari non
  // può uscirne una marcatura di nessun tipo. Il nome per esteso lo cancella
  // comunque SN_ESTERNO quando imbusta, in lettura, dove la tabella dei tipi
  // c'è tutta.
  function neutralizzaMarcature(testo) {
    return String(testo == null ? '' : testo)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/[\r\n\u2028\u2029]+/g, ' ')
      .replace(INVISIBILI_RE, '')
      .replace(/<{2,}/g, '<')
      .replace(/>{2,}/g, '>')
      .replace(/PERCORSI_CONDIVISI/gi, 'percorsi-condivisi');
  }

  // Gli indirizzi email, cercati partendo dalle chiocciole. Scritta come
  // espressione (`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`, i) la regola
  // riprovava da ogni lettera e costava il quadrato della lunghezza: un
  // elemento da trentamila caratteri, un secondo nel processo principale
  // (#1173). Dà lo stesso testo dell'espressione: una sentinella le confronta.
  function lettera(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
  function cifra(c) { return c >= 48 && c <= 57; }
  function carattereDominio(c) { return lettera(c) || cifra(c) || c === 46 || c === 45; }
  function carattereLocale(c) { return carattereDominio(c) || c === 95 || c === 37 || c === 43; }

  function redigiEmail(testo) {
    let chiocciola = testo.indexOf('@');
    if (chiocciola === -1) return testo;
    const n = testo.length;
    let out = '';
    let da = 0;
    while (chiocciola !== -1) {
      let inizio = chiocciola;
      while (inizio > da && carattereLocale(testo.charCodeAt(inizio - 1))) inizio--;
      let fine = -1;
      if (inizio < chiocciola) {
        let coda = chiocciola + 1;
        while (coda < n && carattereDominio(testo.charCodeAt(coda))) coda++;
        // L'ultimo punto seguito da due lettere, con almeno un carattere fra
        // la chiocciola e lui: è quello che l'espressione trova tornando indietro.
        for (let p = coda - 3; p >= chiocciola + 2; p--) {
          if (testo.charCodeAt(p) === 46 && lettera(testo.charCodeAt(p + 1)) && lettera(testo.charCodeAt(p + 2))) {
            fine = p + 3;
            while (fine < n && lettera(testo.charCodeAt(fine))) fine++;
            break;
          }
        }
      }
      if (fine === -1) {
        chiocciola = testo.indexOf('@', chiocciola + 1);
      } else {
        out += testo.slice(da, inizio) + '[EMAIL]';
        da = fine;
        chiocciola = testo.indexOf('@', fine);
      }
    }
    return out + testo.slice(da);
  }

  // Cancella i dati personali da un testo diretto alla raccolta pubblica.
  //
  // Passa di qui OGNI campo che esce dal computer di chi naviga: gli elementi
  // toccati (un'etichetta come [aria-label="Profilo di mario.rossi@x.it"]), la
  // sezione di partenza (/clienti/IT60X.../estratto) e la frase dell'intento,
  // che la scrive un modello ma leggendo gli altri due. Prima la cancellazione
  // valeva solo per gli elementi, e solo per gli indirizzi email e le cifre
  // attaccate: bastava un IBAN, un codice fiscale o un telefono scritto con gli
  // spazi per uscire intero, e quelle sono proprio le etichette delle pagine
  // dove l'Aiuto serve di più (banca, operatore telefonico).
  //
  // L'ordine conta: prima le forme che contengono lettere e cifre insieme
  // (IBAN, codice fiscale), poi le cifre, altrimenti la regola delle cifre
  // spezzerebbe l'IBAN a metà e quel che resta non lo riconoscerebbe più
  // nessuno.
  function redigiDatiPersonali(testo) {
    if (typeof testo !== 'string' || !testo) return '';
    return redigiEmail(testo)
      .replace(IBAN_RE, '[IBAN]')
      .replace(CF_RE, '[CODICE]')
      .replace(LONG_NUM_RE, '[NUMERO]')
      .replace(NUM_SPEZZATO_RE, (m) => ((m.match(/\d/g) || []).length >= 6 ? '[NUMERO]' : m))
      .replace(SOPRANNOME_RE, (_m, prima) => `${prima}[ID]`);
  }

  // Di un campo si pulisce un pezzo poco più lungo di quello che può restarne, non
  // tutto: elementi da centinaia di migliaia di caratteri fermavano l'Aiuto (#1173).
  // Se la pulizia lo accorcia sotto il tetto il pezzo cresce: la coda (quale
  // pulsante, dove si va) arriva come prima, fino a otto volte il tetto: oltre,
  // un campo che è quasi tutto dati da cancellare non vale il costo di cinquanta
  // documenti ostili. Il taglio non lascia in fondo mezza forma (email, codice,
  // numero). Prove: tests/unit/percorsiLunghi.test.mjs.
  const FORMA_MAX = 320; // un indirizzo email non supera i 254 caratteri
  const CRESCITA_MAX = 8;

  function aTetto(testo, max, taglia, pulisci) {
    for (let tetto = max * 2 + FORMA_MAX; ; tetto *= 4) {
      const pezzo = taglia(testo, tetto);
      const out = pulisci(pezzo);
      if (pezzo === testo || out.length >= max + FORMA_MAX || tetto >= max * CRESCITA_MAX) return out.slice(0, max);
    }
  }

  function tagliaPrimaDiPulire(testo, tetto) {
    if (testo.length <= tetto) return testo;
    let fine = tetto;
    const nellaForma = (c) => carattereLocale(c) || c === 64;
    while (fine > tetto - FORMA_MAX && nellaForma(testo.charCodeAt(fine - 1))) fine--;
    const c = testo.charCodeAt(fine - 1);
    if (c >= 0xD800 && c <= 0xDBFF) fine--;
    return testo.slice(0, fine);
  }

  // Un indirizzo si taglia a una barra: un pezzo spezzato può non decodificarsi
  // più, e la pulizia lo leggerebbe cifrato (`%40` al posto della chiocciola).
  // Al posto di quello che non si guarda resta il segnaposto, come per un codice.
  function tagliaPercorsoPrimaDiPulire(path, tetto) {
    if (path.length <= tetto) return path;
    const barra = path.lastIndexOf('/', tetto);
    return barra === -1 ? '' : `${path.slice(0, barra + 1)}[ID]`;
  }

  // Un elemento toccato, pronto per la raccolta: senza dati personali, senza
  // niente che imiti la struttura del prompt, e dentro al tetto.
  function redactSelector(selector) {
    if (typeof selector !== 'string' || !selector) return '';
    return aTetto(selector, MAX_SELECTOR_LEN, tagliaPrimaDiPulire,
      (pezzo) => neutralizzaMarcature(redigiDatiPersonali(pezzo)).trim());
  }

  function sanitizeSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) return [];
    const out = [];
    for (const s of rawSteps) {
      if (!s || typeof s !== 'object') continue;
      const action = AZIONI.includes(s.action) ? s.action : 'click';
      const selector = redactSelector(s.selector);
      if (!selector) continue;
      out.push({ selector, action, retracted: !!s.retracted });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  }

  // Un ciclo e non `/^[…]+|[…]+$/g`: quella riprova la coda da ogni carattere
  // di una fila in mezzo al testo, e il costo cresce col quadrato (#1173).
  function togliAiBordi(s, caratteri) {
    let a = 0;
    let b = s.length;
    while (a < b && caratteri.includes(s[a])) a++;
    while (b > a && caratteri.includes(s[b - 1])) b--;
    return s.slice(a, b);
  }

  // L'intento è UNA riga: la produce un LLM e la rilegge un altro LLM dentro il
  // prompt di un'altra persona. Togliamo il wrapping markdown, teniamo la prima
  // riga, tagliamo a MAX_INTENT_LEN.
  function sanitizeIntent(text) {
    if (typeof text !== 'string') return '';
    // La frase la scrive un modello, ma leggendo gli elementi toccati e la
    // sezione di partenza: quello che ha visto lì può ricopiarlo qui dentro.
    return aTetto(text, MAX_INTENT_LEN, tagliaPrimaDiPulire, (pezzo) => {
      const s = neutralizzaMarcature(redigiDatiPersonali(pezzo)).trim();
      return togliAiBordi(togliAiBordi(s, '"\'`').trim(), '*_').trim();
    }).trim();
  }

  function parseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try { return new URL(rawUrl); } catch (_) { return null; }
  }

  function domainOf(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    // Un nome più lungo del massimo si RIFIUTA, non si taglia: il taglio arrivava prima del
    // controllo sui siti privati, e un nome in «.localhost» ci arrivava come «.lo» (#584).
    const h = normalizzaHost(u.hostname);
    return h.length > MAX_DOMAIN_LEN ? '' : h;
  }

  // Il percorso porta addosso chi sei anche senza codici: `/u/mario.rossi/ordini/847362`.
  // Quindi pezzo per pezzo e per SOTTRAZIONE: `/[ID]` non direbbe più da dove si parte.
  const MARCATORI_PERSONA = new Set([
    'u', 'user', 'users', 'utente', 'utenti', 'profile', 'profil', 'profilo',
    'profili', 'member', 'members', 'membro', 'membri', 'people', 'persone',
    'usr', 'usuario', 'usuarios', 'benutzer', 'utilisateur', 'in', 'author', 'autore',
    'autori', 'cliente', 'clienti', 'customer', 'customers', 'perfil',
    'membres', 'mitglied',
  ]);
  // Fuori di proposito `account`: su quasi ogni sito `/account/…` è «il tuo account» e quello
  // che segue è una pagina, non un nome.

  // `/c/` è il canale su un sito di video ma la CATEGORIA su un negozio (`/c/scarpe-donna`):
  // vale come marcatore solo dove indica davvero una persona.
  const MARCATORI_VIDEO = new Set(['c', 'channel', 'canale']);
  const SITI_VIDEO = new Set([
    'youtube.com', 'youtu.be', 'twitch.tv', 'kick.com', 'rumble.com',
    'odysee.com', 'dailymotion.com', 'vimeo.com',
  ]);

  // Sono i casi che si vedono, non tutti quelli che esistono: la rete generale resta il
  // modello che giudica il percorso prima che parta, e che vede l'indirizzo per intero.
  const SITI_COL_NOME_IN_TESTA = new Set([
    'github.com', 'gitlab.com', 'codeberg.org', 'gitee.com',
    'x.com', 'twitter.com', 'threads.net', 'bsky.app',
    'instagram.com', 'tiktok.com', 'facebook.com', 'snapchat.com',
    'medium.com', 'dev.to', 'hashnode.com', 'behance.net', 'dribbble.com',
    'soundcloud.com', 'patreon.com', 'ko-fi.com', 'twitch.tv', 'kick.com',
    'vimeo.com', 'deviantart.com', 'pinterest.com', 'about.me', 'linktr.ee',
    't.me', 'telegram.me', 'paypal.me', 'venmo.com', 'cash.app',
  ]);

  // Senza questa lista `github.com/notifications` e `instagram.com/explore` uscivano tutti e
  // due come `/[ID]`, cioè identici e inservibili, pur non dicendo niente di nessuno.
  const SEZIONI_PUBBLICHE = new Set([
    'notifications', 'settings', 'explore', 'search', 'about', 'help', 'login',
    'logout', 'signup', 'signin', 'register', 'home', 'trending', 'messages',
    'new', 'pricing', 'terms', 'privacy', 'support', 'download', 'downloads',
    'blog', 'docs', 'documentation', 'features', 'discover', 'watch', 'feed',
    'topics', 'collections', 'marketplace', 'sponsors', 'pulls', 'issues',
    'orgs', 'apps', 'security', 'legal', 'contact', 'jobs', 'careers',
    'status', 'api', 'shop', 'store', 'cart', 'checkout', 'orders', 'ordini',
    'dashboard', 'notifiche', 'impostazioni', 'assistenza', 'aiuto', 'cerca',
    'directory', 'categories', 'tags', 'reels', 'stories', 'live',
  ]);

  // Le forme che, da sole, dicono che un pezzo è un identificativo e non il
  // nome di una sezione.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ESADECIMALE_RE = /^[0-9a-f]{16,}$/i;
  // Un token opaco: lungo, lettere e cifre mescolate, senza separatori che ne facciano una
  // frase. Un nome di sezione con un numero dentro (`v2`, `user_settings`) non ci casca.
  const TOKEN_MISTO_RE = /^(?=.*[0-9])(?=.*[a-z])[a-z0-9]{12,}$/i;
  // Fino a quattro cifre attaccate è un anno, una pagina, un indice; da cinque in su è il
  // numero di un ordine, di un conto, di una pratica.
  const SOLO_CIFRE_LUNGO_RE = /^\d{5,}$/;

  function decodi(segmento) {
    try { return decodeURIComponent(segmento); } catch (_) { return segmento; }
  }

  function hostRientraIn(hostname, insieme) {
    const h = String(hostname || '').toLowerCase();
    if (!h) return false;
    for (const sito of insieme) {
      if (h === sito || h.endsWith(`.${sito}`)) return true;
    }
    return false;
  }

  function redigiSegmento(segmento) {
    const chiaro = decodi(segmento);
    // Un pezzo che una volta decodificato contiene una barra, uno spazio o un a capo non è un
    // pezzo: è due pezzi travestiti da uno, e cambierebbe la forma dell'indirizzo che pubblichiamo.
    if (/[\\/\s]/.test(chiaro)) return '[ID]';
    // `/@mariorossi` è il soprannome di una persona, non un'email: vale come identificativo
    // comunque, ed è la forma dei profili sui siti di video e sui social nuovi.
    if (chiaro.startsWith('@')) return '[ID]';
    if (chiaro.includes('@')) return '[EMAIL]';
    const perForme = redigiDatiPersonali(chiaro);
    if (perForme !== chiaro) return perForme;
    if (UUID_RE.test(chiaro) || ESADECIMALE_RE.test(chiaro)) return '[ID]';
    if (TOKEN_MISTO_RE.test(chiaro)) return '[ID]';
    if (SOLO_CIFRE_LUNGO_RE.test(chiaro)) return '[NUMERO]';
    return chiaro;
  }

  // Dopo il marcatore molti siti mettono un numero e poi il nome (/users/12345/mario-rossi):
  // quindi vale una ZONA di due pezzi, che si chiude al primo pezzo senza quella forma.
  const NOME_PER_ESTESO_RE = /^(?:\d+[-_.])?[A-Za-z][A-Za-z]*(?:[-_.][A-Za-z][A-Za-z]*)+$|^[a-z]+[A-Z][a-z]+/;

  // La forma non distingue `mario-rossi` da `note-spese`, e le sezioni personali stanno dietro
  // allo stesso marcatore: a decidere è la POSIZIONE (`redigiNellaZona`), non la parola.
  const PAROLE_DI_SEZIONE = new Set([
    // articoli, preposizioni, possessivi: da soli non dicono niente, e senza di loro
    // `metodi-di-pagamento` non sarebbe una sezione intera
    'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'de', 'da', 'dal',
    'dalla', 'al', 'alla', 'ai', 'agli', 'alle', 'il', 'lo', 'la', 'i', 'gli',
    'le', 'un', 'uno', 'una', 'e', 'ed', 'o', 'in', 'con', 'su', 'per', 'tra',
    'the', 'of', 'and', 'or', 'to', 'for', 'my', 'your', 'our',
    'mio', 'miei', 'mia', 'mie', 'tuo', 'tuoi', 'tua', 'tue', 'nostro', 'nostri',
    'mis', 'mes', 'mon', 'ma',
    'account', 'profilo', 'profile', 'perfil', 'profil', 'utente', 'utenti',
    'user', 'users', 'usuario', 'cliente', 'clienti', 'customer', 'dati',
    'data', 'personali', 'personale', 'personal', 'anagrafica', 'impostazioni',
    'settings', 'preferenze', 'preferences', 'privacy', 'sicurezza', 'security',
    'password', 'passwords', 'credenziali', 'credentials', 'accesso',
    'email', 'telefono', 'phone', 'lingua', 'language', 'tema', 'theme',
    'notifiche', 'notifications', 'consensi', 'consent', 'two', 'factor',
    'auth', 'authentication', 'sign', 'reset',
    'ordini', 'ordine', 'orders', 'order', 'acquisti', 'acquisto', 'purchases',
    'purchase', 'carrello', 'cart', 'checkout', 'pagamento', 'pagamenti',
    'payment', 'payments', 'metodi', 'metodo', 'method', 'methods',
    'card', 'cards', 'credito', 'credit', 'debito', 'debit',
    'fattura', 'fatture', 'invoice', 'invoices', 'billing', 'ricevuta',
    'ricevute', 'receipt', 'receipts', 'spese', 'spesa', 'expenses', 'expense',
    'rimborso', 'rimborsi', 'refund', 'refunds', 'abbonamento', 'abbonamenti',
    'subscription', 'subscriptions', 'plan', 'plans', 'saldo', 'balance',
    'estratto', 'conto', 'movimenti', 'transazioni', 'transactions',
    'portafoglio', 'wallet', 'spedizione', 'spedizioni', 'shipping',
    'consegna', 'consegne', 'delivery', 'resi', 'returns', 'indirizzo',
    'indirizzi', 'address', 'addresses', 'buoni', 'coupon', 'coupons',
    'punti', 'points', 'premi', 'rewards',
    'note', 'notes', 'nota', 'documenti', 'documents', 'allegati', 'attachments', 'contratto',
    'contratti', 'contract', 'contracts', 'bolletta', 'bollette', 'consumi',
    'letture', 'messaggi', 'messages', 'chat', 'commenti', 'comments',
    'recensioni', 'reviews', 'valutazioni', 'ratings', 'preferiti',
    'favorites', 'wishlist', 'desideri', 'lista', 'liste', 'list', 'lists',
    'storico', 'cronologia', 'history', 'attivita', 'activity', 'sessioni',
    'sessions', 'dispositivi', 'devices', 'file', 'files', 'foto', 'photos',
    'immagini', 'images', 'video', 'articoli', 'articles', 'progetti',
    'projects', 'gruppi', 'groups', 'team', 'teams', 'salvati', 'saved',
    'items', 'elenco', 'elenchi',
    'modifica', 'modificare', 'edit', 'cambia', 'cambio', 'change', 'aggiungi',
    'add', 'nuovo', 'nuova', 'new', 'crea', 'create', 'elimina', 'rimuovi',
    'delete', 'remove', 'gestisci', 'gestione', 'manage', 'visualizza', 'view',
    'scarica', 'download', 'stampa', 'print', 'cerca', 'search', 'filtra',
    'filter', 'dettaglio', 'dettagli', 'detail', 'details', 'riepilogo',
    'summary', 'panoramica', 'overview', 'verifica', 'verify', 'conferma',
    'confirm', 'disdetta', 'cancel', 'annulla', 'recenti', 'recent',
    'assistenza', 'aiuto', 'help', 'support', 'contatti', 'contact', 'faq',
    'guida', 'guide', 'info', 'informazioni', 'area', 'riservata', 'sezione',
    'pagina', 'page', 'dashboard', 'bacheca', 'pannello', 'panel', 'admin',
  ]);

  function parolaDiSezione(parola) {
    const p = String(parola).toLowerCase();
    return PAROLE_DI_SEZIONE.has(p) || SEZIONI_PUBBLICHE.has(p);
  }

  // Tiene le parole da sezione finché ne trova; dalla prima che non lo è resta un segnaposto.
  // Il nome sta sempre dalla parte del segnaposto: una parola fuori lista è forse un cognome.
  function redigiNellaZona(pezzo) {
    const chiaro = decodi(pezzo);
    // Il separatore resta dov'è: `metodi-di-pagamento` non deve tornare
    // `metodididiagamento` se un giorno la lista cambia.
    const parti = chiaro.split(/([-_.])/);
    let tenuto = '';
    for (let i = 0; i < parti.length; i += 2) {
      const parola = parti[i];
      if (!parola || !parolaDiSezione(parola)) {
        return tenuto ? `${tenuto}[ID]` : '[ID]';
      }
      tenuto += parola;
      const sep = parti[i + 1];
      if (sep === undefined) return tenuto;
      tenuto += sep;
    }
    return tenuto || '[ID]';
  }

  // Serve solo dal secondo pezzo della zona in poi: là un pezzo senza quella forma è quasi
  // sempre il nome di una sezione. Il primo pezzo lo decide `redigiNellaZona`.
  function sembraNomeDiPersona(pezzo) {
    const chiaro = decodi(pezzo);
    if (SEZIONI_PUBBLICHE.has(chiaro.toLowerCase())) return false;
    // Un nome di file non è un nome di persona: `carta-identita.html`.
    if (/\.(html?|php|aspx?|jsp|json|xml|pdf)$/i.test(chiaro)) return false;
    return NOME_PER_ESTESO_RE.test(chiaro);
  }

  function redigiPercorso(path, hostname) {
    const nomeInTesta = hostRientraIn(hostname, SITI_COL_NOME_IN_TESTA);
    const video = hostRientraIn(hostname, SITI_VIDEO);
    const pezzi = String(path || '').split('/');
    const out = [];
    let precedente = '';
    let primoPieno = true;
    let zonaPersona = 0;
    for (const pezzo of pezzi) {
      if (!pezzo) { out.push(pezzo); continue; }
      const prec = decodi(precedente).toLowerCase();
      const marcatore = MARCATORI_PERSONA.has(prec) || (video && MARCATORI_VIDEO.has(prec));
      if (marcatore) {
        // Il primo pezzo dopo il marcatore diventava un segnaposto anche quando era il nome della
        // sezione: `/utente/ordini` e `/utente/preferiti` arrivavano identici a chi legge.
        out.push(redigiNellaZona(pezzo));
        zonaPersona = 2;
      } else if (primoPieno && nomeInTesta && !SEZIONI_PUBBLICHE.has(decodi(pezzo).toLowerCase())) {
        out.push('[ID]');
      } else if (zonaPersona > 0 && sembraNomeDiPersona(pezzo)) {
        out.push(redigiNellaZona(pezzo));
        zonaPersona -= 1;
      } else {
        out.push(redigiSegmento(pezzo));
        zonaPersona = 0;
      }
      primoPieno = false;
      precedente = pezzo;
    }
    return out.join('/');
  }

  // Per il matching futuro servono URL «stabili»: si tiene il path e si buttano query e
  // fragment, che di solito portano parametri dell'utente o stato di UI.
  function normalizedPath(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    return aTetto(u.pathname || '/', MAX_URL_LEN, tagliaPercorsoPrimaDiPulire,
      (pezzo) => redigiPercorso(pezzo, u.hostname)) || '/';
  }

  function sanitizeDomain(raw) {
    // Anche qui si rifiuta invece di tagliare: vedi `domainOf`.
    const d = normalizzaHost(raw);
    if (d.length > MAX_DOMAIN_LEN) return '';
    if (!DOMINIO_RE.test(d)) return '';
    return sitoCondivisibile(d) ? d : '';
  }

  // `domain` serve alla seconda regola (i siti col nome in testa) quando qui arriva un
  // percorso già senza host: è il caso della RI-lettura di un documento vecchio.
  function sanitizeInitialUrl(raw, domain) {
    // Accetta sia un URL intero (lo riduce al path) sia un path già normalizzato.
    const s = String(raw || '').trim();
    if (!s) return '/';
    if (/^https?:\/\//i.test(s)) return normalizedPath(s) || '/';
    return aTetto(s, MAX_URL_LEN, tagliaPercorsoPrimaDiPulire, (pezzo) => {
      const ripulito = neutralizzaMarcature(pezzo).trim().replace(/\s+/g, '');
      return ripulito.startsWith('/') ? redigiPercorso(ripulito, domain || '') : '';
    }) || '/';
  }

  // Nel documento niente del mittente (#584): né clientId né userAgent, che li legava.
  function sanitizeSubmission(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload vuoto' };

    const grezzo = normalizzaHost(raw.domain);
    const domain = sanitizeDomain(grezzo);
    if (!domain) {
      // Due motivi diversi, e vale la pena distinguerli: uno è un dato
      // malformato, l'altro è una scelta.
      return {
        ok: false,
        reason: DOMINIO_RE.test(grezzo)
          ? 'sito privato o locale: non si condivide'
          : 'dominio non valido',
      };
    }

    const intent = sanitizeIntent(raw.intent);
    if (!intent) return { ok: false, reason: 'intento vuoto' };

    const steps = sanitizeSteps(raw.steps);
    if (!steps.length) return { ok: false, reason: 'nessuno step utile dopo la pulizia' };

    return {
      ok: true,
      doc: {
        domain,
        initialUrl: sanitizeInitialUrl(raw.initialUrl, domain),
        intent,
        steps,
        success: !!raw.success,
      },
    };
  }

  // ─────────────────────────── lato lettura ────────────────────────────────

  function clusterKey(p) {
    const init = (p && p.initialUrl) || '';
    const steps = Array.isArray(p && p.steps) ? p.steps : [];
    const sig = steps.map((s) => `${(s && s.action) || 'click'}|${(s && s.selector) || ''}`).join(',');
    return init + '::' + sig;
  }

  // Per il messaggio di sistema dell'Aiuto: ogni campo ripassa dalla pulizia (vedi in cima).
  function formatKnownPathsForPrompt(rawPaths) {
    if (!Array.isArray(rawPaths) || !rawPaths.length) return '';
    const seen = new Set();
    const blocchi = [];
    let chars = 0;
    for (const p of rawPaths) {
      if (!p || typeof p !== 'object') continue;
      const steps = sanitizeSteps(p.steps);
      // Un percorso senza passi non insegna niente: sarebbe solo una frase di ignoto autore dentro
      // il prompt di qualcun altro.
      if (!steps.length) continue;
      const init = sanitizeInitialUrl(p.initialUrl, p.domain);
      // I doppioni si cercano su quello che il prompt vedrà: la chiave sul
      // documento grezzo copiava e confrontava campi interi da un mega (#1173).
      const k = clusterKey({ initialUrl: init, steps });
      if (seen.has(k)) continue;
      seen.add(k);
      const intent = sanitizeIntent(p.intent) || '(intento ignoto)';
      const header = `## "${intent}" (da ${init})`;
      const stepLines = steps.map((s, i) =>
        `  ${i + 1}. ${s.action} su ${s.selector}${s.retracted ? ' [poi corretto]' : ''}`);
      let block = [header, ...stepLines].join('\n');
      // Nessun percorso da solo si prende più di una fetta del tetto, o gli altri dello stesso
      // dominio restano fuori. Quello che non ci sta si taglia dicendolo, non in silenzio.
      if (block.length > MAX_PATH_CHARS) {
        const tenute = [];
        let usati = header.length;
        for (const riga of stepLines) {
          if (usati + riga.length + 1 > MAX_PATH_CHARS) break;
          tenute.push(riga);
          usati += riga.length + 1;
        }
        block = [header, ...tenute, '  (percorso più lungo: il resto dei passi non è riportato)'].join('\n');
      }
      // Il percorso che non ci sta si SALTA, non chiude la fila: fermarsi al primo buttava via
      // anche tutti quelli dopo, che nel tetto ci stavano.
      if (chars + block.length + 2 > KNOWN_PATHS_BUDGET_CHARS) continue;
      blocchi.push(block);
      chars += block.length + 2;
    }
    if (!blocchi.length) return '';
    // L'intestazione qui non si chiede: la scrive per esteso il prompt
    // dell'Aiuto, che ha spazio per dire anche a cosa servono i percorsi e
    // perché vanno verificati nell'outline.
    return esterno().imbusta({
      tipo: TIPO_ESTERNO,
      testo: blocchi.join('\n\n'),
      max: KNOWN_PATHS_BUDGET_CHARS,
    });
  }

  global.SN_PATHS_SAFETY = {
    sanitizeSubmission,
    formatKnownPathsForPrompt,
    // Vale nei due sensi: un sito che non si condivide non si legge nemmeno, o un percorso
    // depositato sotto `localhost` tornerebbe a chiunque apra l'Aiuto su una pagina locale.
    sitoCondivisibile,
    // Le due marcature le decide SN_ESTERNO, che è l'unico a sapere come è
    // fatta una busta. Qui sono due finestre su quella tabella, lette quando
    // servono: nessuna copia da tenere allineata a mano.
    get FENCE_START() { return esterno().marcature(TIPO_ESTERNO).inizio; },
    get FENCE_END() { return esterno().marcature(TIPO_ESTERNO).fine; },
    LIMITI: { MAX_STEPS, MAX_SELECTOR_LEN, MAX_INTENT_LEN, MAX_DOMAIN_LEN, MAX_URL_LEN, KNOWN_PATHS_BUDGET_CHARS, MAX_PATH_CHARS },
    // Esposti per i test e per chi riusa i singoli pezzi.
    _internal: {
      neutralizzaMarcature, redigiDatiPersonali, redactSelector, sanitizeSteps, sanitizeIntent,
      domainOf, normalizedPath, sanitizeDomain, sanitizeInitialUrl, clusterKey,
      redigiPercorso, redigiSegmento, INVISIBILI_RE, SUFFISSI_PRIVATI, normalizzaHost,
      sembraNomeDiPersona, redigiNellaZona, parolaDiSezione, PAROLE_DI_SEZIONE,
      redigiEmail, togliAiBordi, tagliaPrimaDiPulire, tagliaPercorsoPrimaDiPulire, FORMA_MAX,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
