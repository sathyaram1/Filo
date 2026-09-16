// I percorsi condivisi (`paths`) sono l'unico contenuto di Filo scritto da un utente e LETTO
// nel prompt di un altro: chi li avvelena colpisce chi visiterà quel dominio. In SCRITTURA
// `sanitizeSubmission()` decide cosa entra (dominio, una riga di intento, selettori redatti,
// azioni note, tetto ai passi): la applica il client e la RIAPPLICA il server, e sta in
// src/shared/ perché è da qui che il backend incorpora i moduli al deploy.
// In LETTURA `formatKnownPathsForPrompt()` impacchetta i percorsi fra due marcature e li
// ripulisce di nuovo: nella raccolta restano documenti scritti quando poteva farlo chiunque.

(function (global) {
  'use strict';

  // Stessi numeri dei vincoli in firestore.rules: se cambiano qui vanno cambiati là (e
  // viceversa), o una scrittura passerebbe un controllo e non l'altro.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_INTENT_LEN = 200;
  const MAX_DOMAIN_LEN = 253;
  const MAX_URL_LEN = 2000;

  // Quanto spazio del prompt possono occupare in tutto i percorsi noti.
  const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;
  // Tetto per UN percorso solo: senza, uno lungo si mangia quasi tutto il resto e sulla
  // stessa pagina gli altri non arrivano più al modello.
  const MAX_PATH_CHARS = Math.floor(KNOWN_PATHS_BUDGET_CHARS / 4);

  // Le due righe che delimitano il blocco nel messaggio di sistema. Il testo dei percorsi non
  // può contenerle (`neutralizzaMarcature`): basterebbe un intento che scrive la riga di
  // chiusura per far credere al modello che ciò che segue non è più contenuto esterno.
  const FENCE_START = '<<<PERCORSI_CONDIVISI>>>';
  const FENCE_END = '<<<FINE_PERCORSI_CONDIVISI>>>';

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const LONG_NUM_RE = /\b\d{6,}\b/g;
  // IBAN e codice fiscale non sono fatti di sole cifre (due lettere davanti al primo, lettere
  // e cifre alternate nel secondo): la regola delle cifre attaccate non li vedeva e uscivano
  // interi in una raccolta che legge chiunque.
  const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
  const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
  // Cifre separate da spazi, punti o trattini: «333 123 456», «06.1234.5678». Il conteggio lo
  // fa chi sostituisce e passa solo con almeno sei cifre, così «riga 2 di 3» resta com'è e un
  // telefono no.
  const NUM_SPEZZATO_RE = /\d[\d \u00A0.\-/]{3,}\d/g;
  // Il soprannome con la chiocciola: nell'etichetta di un pulsante — che finisce nello stesso
  // documento pubblico — usciva intero (#584). Il `@` deve aprire la parola (inizio riga,
  // spazio o virgoletta), così «Profilo di @mariorossi» si ripulisce e un nome di classe CSS
  // con la chiocciola protetta (`.\@sm\:flex`) resta quello che è.
  const SOPRANNOME_RE = /(^|[\s"'])@[A-Za-z0-9._-]{2,40}/g;
  const AZIONI = ['click', 'fill', 'reveal', 'hover'];

  // Un dominio è un hostname: niente spazi, a capo o slash, cioè niente frasi travestite da
  // dominio.
  const DOMINIO_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  // I SITI CHE NON SONO DI NESSUNO (#584). Il nome del sito è l'unica delle quattro cose che
  // un percorso pubblica a non poter essere ripulita — è anche l'indirizzo Firestore del
  // documento — quindi o esce com'è o non esce. Per i siti pubblici esce e lo guarda il
  // modello che giudica; per gli indirizzi che non portano fuori da casa di chi naviga
  // (router, NAS, `localhost`, intranet, pagine interne di Filo) il percorso non serve a
  // nessun altro mentre il nome dice dove lavori: lì il prezzo è tutto e il guadagno zero.
  // La lista guarda l'ultimo pezzo del nome: suffissi delle reti private, nomi che per
  // convenzione non esisteranno mai su Internet (`app.localhost` dei contenitori,
  // `progetto-rossi.test` col nome del cliente, `.invalid`, `.example`) e reti anonime, dove
  // il nome del sito È il segreto.
  const SUFFISSI_PRIVATI = new Set([
    // reti private e nomi di casa
    'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'arpa',
    // nomi riservati: non sono e non saranno mai su Internet
    'localhost', 'test', 'invalid', 'example',
    // reti anonime
    'onion', 'alt', 'i2p',
  ]);
  const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

  // IL PUNTO FINALE: un host può finire con un punto — è la forma assoluta dello stesso nome,
  // e `localhost.` è lo stesso computer di `localhost`. Con quel punto l'ultimo pezzo è vuoto
  // e la lista qui sopra non lo riconosceva più. Si toglie prima di ogni controllo e ovunque,
  // anche in lettura (paths.js → segmentoDominio), o le due strade parlerebbero di due
  // cartelle diverse per lo stesso sito.
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

  // I SEGNI CHE NON SI VEDONO: un'etichetta che a occhio dice «Profilo» può portarsi dietro
  // una frase scritta con caratteri invisibili, arrivare davanti ai modelli che giudicano e
  // poi finire pubblicata. Si tolgono larghezza zero e marcatori di direzione, i caratteri
  // «tag» U+E0000-U+E007F (copia invisibile dell'alfabeto: è con quelli che si nasconde
  // davvero del testo) e i selettori di variante. La stessa famiglia la toglie
  // SN_CONST.unaRigaDiDati, e una sentinella diventa rossa se le due divergono.
  const INVISIBILI_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff]|[\u{E0000}-\u{E007F}]/gu;

  // Toglie ciò che, in un testo diretto al prompt, servirebbe solo a fingere di esserne la
  // struttura: caratteri di controllo, a capo (ogni campo è una riga sola), sequenze di < o >
  // e il nome delle marcature.
  function neutralizzaMarcature(testo) {
    return String(testo == null ? '' : testo)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/[\r\n\u2028\u2029]+/g, ' ')
      .replace(INVISIBILI_RE, '')
      .replace(/<{2,}/g, '<')
      .replace(/>{2,}/g, '>')
      .replace(/PERCORSI_CONDIVISI/gi, 'percorsi-condivisi');
  }

  // Cancella i dati personali da OGNI campo che esce dal computer di chi naviga: elementi
  // toccati, sezione di partenza e frase dell'intento. Prima valeva solo per gli elementi e
  // solo per email e cifre attaccate: un IBAN, un codice fiscale o un telefono con gli spazi
  // usciva intero, e sono proprio le etichette delle pagine dove l'Aiuto serve di più.
  // L'ordine conta: prima le forme con lettere e cifre insieme, poi le cifre, o la regola
  // delle cifre spezzerebbe l'IBAN a metà.
  function redigiDatiPersonali(testo) {
    if (typeof testo !== 'string' || !testo) return '';
    return testo
      .replace(EMAIL_RE, '[EMAIL]')
      .replace(IBAN_RE, '[IBAN]')
      .replace(CF_RE, '[CODICE]')
      .replace(LONG_NUM_RE, '[NUMERO]')
      .replace(NUM_SPEZZATO_RE, (m) => ((m.match(/\d/g) || []).length >= 6 ? '[NUMERO]' : m))
      .replace(SOPRANNOME_RE, (_m, prima) => `${prima}[ID]`);
  }

  // Un elemento toccato, pronto per la raccolta: senza dati personali, senza
  // niente che imiti la struttura del prompt, e dentro al tetto.
  function redactSelector(selector) {
    if (typeof selector !== 'string' || !selector) return '';
    let s = redigiDatiPersonali(selector);
    s = neutralizzaMarcature(s).trim();
    if (s.length > MAX_SELECTOR_LEN) s = s.slice(0, MAX_SELECTOR_LEN);
    return s;
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

  // L'intento è UNA riga: la produce un LLM e la rilegge un altro LLM dentro il prompt di
  // un'altra persona. Via il wrapping markdown, si tiene la prima riga, taglio a MAX_INTENT_LEN.
  function sanitizeIntent(text) {
    if (typeof text !== 'string') return '';
    // La frase la scrive un modello leggendo elementi e sezione di partenza: quello che ha
    // visto lì può ricopiarlo qui dentro.
    let s = neutralizzaMarcature(redigiDatiPersonali(text)).trim();
    if (!s) return '';
    s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
    s = s.replace(/^[*_]+|[*_]+$/g, '').trim();
    if (s.length > MAX_INTENT_LEN) s = s.slice(0, MAX_INTENT_LEN);
    return s.trim();
  }

  function parseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try { return new URL(rawUrl); } catch (_) { return null; }
  }

  function domainOf(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    // hostname senza porta e senza il punto finale; «www.» non si toglie, per restare letterali.
    // Un nome più lungo del massimo si RIFIUTA, non si taglia: il taglio arrivava prima del
    // controllo sui siti che non sono di nessuno, e un nome lunghissimo che finiva in
    // «.localhost» ci arrivava finendo in «.lo» (#584). Oltre 253 caratteri un host non è
    // nemmeno valido.
    const h = normalizzaHost(u.hostname);
    return h.length > MAX_DOMAIN_LEN ? '' : h;
  }

  // La sezione di partenza, a pezzi. Query e frammento si buttano, ma il percorso porta
  // spesso addosso chi sei anche senza codici: `/u/mario.rossi/ordini/847362` dice il nome, e
  // un nome utente è spesso lo stesso su più siti — due percorsi che lo contengono sono della
  // stessa persona. La cancellazione per forme non lo vede, quindi si guarda PEZZO PER PEZZO:
  // 1. il pezzo dopo una parola che ANNUNCIA una persona (`/u/`, `/profilo/`, `/clienti/`…)
  // è un nome: segnaposto;
  // 2. sui siti col nome utente in testa (github.com/mariorossi) il PRIMO pezzo è un nome,
  // salvo che sia una sezione pubblica riconoscibile (`/explore`);
  // 3. per il resto si tolgono le FORME che identificano: email, IBAN, codici, UUID, token
  // misti, cifre da cinque in su.
  // La terza regola è per SOTTRAZIONE: tenendo solo i pezzi di sole lettere sparivano
  // `carta-identita.html`, `v2`, `user_settings`, e un indirizzo ridotto a `/[ID]` non dice
  // più da che punto del sito si parte, l'unica cosa per cui lo si legge.
  const MARCATORI_PERSONA = new Set([
    'u', 'user', 'users', 'utente', 'utenti', 'profile', 'profil', 'profilo',
    'profili', 'member', 'members', 'membro', 'membri', 'people', 'persone',
    'usr', 'usuario', 'usuarios', 'benutzer', 'utilisateur', 'in', 'author', 'autore',
    'autori', 'cliente', 'clienti', 'customer', 'customers', 'perfil',
    'membres', 'mitglied',
  ]);
  // Fuori di proposito `account`: su quasi ogni sito `/account/…` è «il tuo account» e quello
  // che segue è una pagina, non un nome — fra i marcatori cancellava il punto di partenza
  // più comune che ci sia.

  // `/c/` è il canale su un sito di video ma la CATEGORIA su un negozio, dove è il punto di
  // partenza più utile che esista (`/c/scarpe-donna`): vale come marcatore solo dove indica
  // davvero una persona.
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

  // IL NOME CHE STA UN PEZZO PIÙ IN LÀ: dopo il marcatore moltissimi siti mettono un numero e
  // SUBITO DOPO il nome per esteso della stessa persona (`/users/12345/mario-rossi`). Quindi
  // si resta in una ZONA della persona, al massimo due pezzi, dove anche un pezzo con la FORMA
  // di un nome per esteso diventa segnaposto: due o più parole attaccate da `-`, `.` o `_`,
  // oppure una maiuscola in mezzo (`MarioRossi`). La zona si chiude al primo pezzo senza
  // quella forma, così `/user/mariorossi/comments/abc` tiene «comments»; una parola sola tutta
  // minuscola non si distingue da una sezione e resta.
  const NOME_PER_ESTESO_RE = /^(?:\d+[-_.])?[A-Za-z][A-Za-z]*(?:[-_.][A-Za-z][A-Za-z]*)+$|^[a-z]+[A-Z][a-z]+/;

  // LE PAROLE CHE FANNO UNA SEZIONE, NON UN COGNOME. La forma non distingue `mario-rossi` da
  // `note-spese`, e le sezioni delle aree personali stanno dietro allo stesso marcatore
  // (`/clienti/12345/note-spese`): il punto di partenza usciva `/clienti/[ID]/[ID]`, che non
  // dice più da dove si parte. Le due risposte provate prima sbagliavano in direzioni opposte:
  // UNA parola da sezione che salva il pezzo faceva uscire il cognome accanto
  // (`rossi-fatture`), pretenderle TUTTE faceva sparire le sezioni vere
  // (`fatture-elettroniche`). La domanda giusta è sulla POSIZIONE (`redigiNellaZona`).
  // Articoli e preposizioni stanno in lista perché `metodi-di-pagamento` sia una sezione
  // intera; `carta` e `piano`, cognomi veri, restano fuori.
  const PAROLE_DI_SEZIONE = new Set([
    // articoli, preposizioni, possessivi: da soli non dicono niente, e senza di loro
    // `metodi-di-pagamento` non sarebbe una sezione intera
    'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'de', 'da', 'dal',
    'dalla', 'al', 'alla', 'ai', 'agli', 'alle', 'il', 'lo', 'la', 'i', 'gli',
    'le', 'un', 'uno', 'una', 'e', 'ed', 'o', 'in', 'con', 'su', 'per', 'tra',
    'the', 'of', 'and', 'or', 'to', 'for', 'my', 'your', 'our',
    'mio', 'miei', 'mia', 'mie', 'tuo', 'tuoi', 'tua', 'tue', 'nostro', 'nostri',
    'mis', 'mes', 'mon', 'ma',
    // il conto e i suoi dati
    'account', 'profilo', 'profile', 'perfil', 'profil', 'utente', 'utenti',
    'user', 'users', 'usuario', 'cliente', 'clienti', 'customer', 'dati',
    'data', 'personali', 'personale', 'personal', 'anagrafica', 'impostazioni',
    'settings', 'preferenze', 'preferences', 'privacy', 'sicurezza', 'security',
    'password', 'passwords', 'credenziali', 'credentials', 'accesso',
    'email', 'telefono', 'phone', 'lingua', 'language', 'tema', 'theme',
    'notifiche', 'notifications', 'consensi', 'consent', 'two', 'factor',
    'auth', 'authentication', 'sign', 'reset',
    // soldi, acquisti, spedizioni
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
    // contenuti e relazioni
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
    // verbi e parole di comando
    'modifica', 'modificare', 'edit', 'cambia', 'cambio', 'change', 'aggiungi',
    'add', 'nuovo', 'nuova', 'new', 'crea', 'create', 'elimina', 'rimuovi',
    'delete', 'remove', 'gestisci', 'gestione', 'manage', 'visualizza', 'view',
    'scarica', 'download', 'stampa', 'print', 'cerca', 'search', 'filtra',
    'filter', 'dettaglio', 'dettagli', 'detail', 'details', 'riepilogo',
    'summary', 'panoramica', 'overview', 'verifica', 'verify', 'conferma',
    'confirm', 'disdetta', 'cancel', 'annulla', 'recenti', 'recent',
    // assistenza e parole di servizio
    'assistenza', 'aiuto', 'help', 'support', 'contatti', 'contact', 'faq',
    'guida', 'guide', 'info', 'informazioni', 'area', 'riservata', 'sezione',
    'pagina', 'page', 'dashboard', 'bacheca', 'pannello', 'panel', 'admin',
  ]);

  function parolaDiSezione(parola) {
    const p = String(parola).toLowerCase();
    return PAROLE_DI_SEZIONE.has(p) || SEZIONI_PUBBLICHE.has(p);
  }

  // Un pezzo dentro la zona della persona: tiene le parole da sezione FINCHÉ ne trova, e dalla
  // prima parola che una sezione non è in poi resta un segnaposto solo; se la prima già non lo
  // è, del pezzo non resta niente.
  // fatture-elettroniche → fatture-[ID]   note-spese → note-spese   ordini → ordini
  // rossi-fatture → [ID]   mario-nuovo → [ID]   mariorossi → [ID]
  // Il nome finisce sempre dalla parte del segnaposto: una parola fuori lista può essere un
  // cognome, e tutto ciò che la segue se ne va con lei.
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
  // sempre il nome di una sezione e passa dalla pulizia normale. Il primo pezzo dopo il
  // marcatore non passa di qui — là il nome ci sta sempre, e la domanda la fa `redigiNellaZona`.
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
    // Quanti pezzi ancora valgono come «zona della persona» dopo il marcatore.
    let zonaPersona = 0;
    for (const pezzo of pezzi) {
      if (!pezzo) { out.push(pezzo); continue; }
      const prec = decodi(precedente).toLowerCase();
      const marcatore = MARCATORI_PERSONA.has(prec) || (video && MARCATORI_VIDEO.has(prec));
      if (marcatore) {
        // Il primo pezzo dopo il marcatore diventava un segnaposto anche quando era il nome della
        // sezione: `/utente/ordini` e `/utente/preferiti` arrivavano tutti e due «da /utente/[ID]»,
        // e chi legge non aveva più niente con cui scegliere fra i due.
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
    let path = redigiPercorso(u.pathname || '/', u.hostname) || '/';
    if (path.length > MAX_URL_LEN) path = path.slice(0, MAX_URL_LEN);
    return path;
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
    const ripulito = neutralizzaMarcature(s).trim().replace(/\s+/g, '');
    if (!ripulito.startsWith('/')) return '/';
    return redigiPercorso(ripulito, domain || '').slice(0, MAX_URL_LEN) || '/';
  }

  // LA pulizia: quella che il client applica prima di inviare e che il server RIAPPLICA prima
  // di scrivere. Ritorna { ok, doc } oppure { ok:false, reason }.
  // NEL DOCUMENTO NON C'È NIENTE DEL MITTENTE (#584): né il `clientId`, che serve al server
  // per i limiti di frequenza e viaggia ACCANTO al documento, né lo `userAgent`, che da solo
  // (sistema, versione, lingua) bastava a rimettere insieme i percorsi della stessa
  // installazione su domini diversi. `domain` resta come dato di comodo ma non decide più
  // dove il documento finisce: il dominio è un SEGMENTO del percorso Firestore, ed è così
  // che una lettura può chiedere un sito solo invece della raccolta intera.
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

  // Impacchetta i percorsi per il messaggio di sistema dell'agente Aiuto; '' se non c'è niente
  // da mostrare, così il prompt non apre un blocco vuoto. Ogni campo ripassa dalla pulizia: i
  // documenti già nella raccolta possono essere nati quando scriverli non richiedeva niente.
  function formatKnownPathsForPrompt(rawPaths) {
    if (!Array.isArray(rawPaths) || !rawPaths.length) return '';
    const seen = new Set();
    const dedup = [];
    for (const p of rawPaths) {
      if (!p || typeof p !== 'object') continue;
      const k = clusterKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(p);
    }
    const blocchi = [];
    let chars = 0;
    for (const p of dedup) {
      const steps = sanitizeSteps(p.steps);
      // Un percorso senza passi non insegna niente: sarebbe solo una frase di ignoto autore dentro
      // il prompt di qualcun altro.
      if (!steps.length) continue;
      const intent = sanitizeIntent(p.intent) || '(intento ignoto)';
      const init = sanitizeInitialUrl(p.initialUrl, p.domain);
      const header = `## "${intent}" (da ${init})`;
      const stepLines = steps.map((s, i) =>
        `  ${i + 1}. ${s.action} su ${s.selector}${s.retracted ? ' [poi corretto]' : ''}`);
      let block = [header, ...stepLines].join('\n');
      // Nessun percorso da solo si prende più di una fetta del tetto: trenta passi con etichette
      // lunghe fanno quindicimila caratteri, e tutti gli altri di quel dominio resterebbero fuori.
      // Quello che non ci sta si taglia dicendolo, invece di sparire in silenzio.
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
    return `${FENCE_START}\n${blocchi.join('\n\n')}\n${FENCE_END}`;
  }

  global.SN_PATHS_SAFETY = {
    sanitizeSubmission,
    formatKnownPathsForPrompt,
    // Vale nei due sensi: un sito che non si condivide non si legge nemmeno, o un percorso
    // depositato sotto `localhost` tornerebbe a chiunque apra l'Aiuto su una pagina locale.
    sitoCondivisibile,
    FENCE_START,
    FENCE_END,
    LIMITI: { MAX_STEPS, MAX_SELECTOR_LEN, MAX_INTENT_LEN, MAX_DOMAIN_LEN, MAX_URL_LEN, KNOWN_PATHS_BUDGET_CHARS, MAX_PATH_CHARS },
    // Esposti per i test e per chi riusa i singoli pezzi.
    _internal: {
      neutralizzaMarcature, redigiDatiPersonali, redactSelector, sanitizeSteps, sanitizeIntent,
      domainOf, normalizedPath, sanitizeDomain, sanitizeInitialUrl, clusterKey,
      redigiPercorso, redigiSegmento, INVISIBILI_RE, SUFFISSI_PRIVATI, normalizzaHost,
      sembraNomeDiPersona, redigiNellaZona, parolaDiSezione, PAROLE_DI_SEZIONE,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
