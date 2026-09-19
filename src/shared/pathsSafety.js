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

  // Limiti di forma. Stessi numeri dei vincoli in firestore.rules: se cambiano
  // qui vanno cambiati là (e viceversa), o una scrittura del server passerebbe
  // un controllo e non l'altro.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_INTENT_LEN = 200;
  const MAX_DOMAIN_LEN = 253;
  const MAX_URL_LEN = 2000;

  // Quanto spazio del prompt possono occupare in tutto i percorsi noti.
  const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;
  // E quanto ne può prendere UNO solo. Senza questo tetto un percorso lungo si
  // mangia quasi tutto il resto, e sulla stessa pagina gli altri non arrivano
  // più al modello.
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

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const LONG_NUM_RE = /\b\d{6,}\b/g;
  // Un IBAN e un codice fiscale non sono fatti di sole cifre: due lettere e due
  // cifre davanti al primo, lettere e cifre alternate nel secondo. La regola
  // delle cifre attaccate non li vedeva, e uscivano interi in una raccolta che
  // legge chiunque.
  const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
  const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
  // Cifre separate da spazi, punti o trattini: «333 123 456», «4111 1111 1111
  // 1111», «06.1234.5678». Il conteggio delle cifre lo fa chi sostituisce: qui
  // si prende il candidato e passa solo se di cifre ce ne sono almeno sei, così
  // «riga 2 di 3» resta com'è e un telefono no.
  const NUM_SPEZZATO_RE = /\d[\d \u00A0.\-/]{3,}\d/g;
  // Il soprannome con la chiocciola. Nell'indirizzo `@mariorossi` diventava gi\u00E0
  // un segnaposto; nell'etichetta di un pulsante \u2014 che finisce nello stesso
  // documento pubblico \u2014 usciva intero (#584, ottavo giro). Il `@` deve aprire
  // la parola: preceduto da inizio riga, spazio o virgoletta. Cos\u00EC \u00ABProfilo di
  // @mariorossi\u00BB si ripulisce e un nome di classe CSS che contiene una
  // chiocciola protetta (`.\@sm\:flex`) resta quello che \u00E8.
  const SOPRANNOME_RE = /(^|[\s"'])@[A-Za-z0-9._-]{2,40}/g;
  const AZIONI = ['click', 'fill', 'reveal', 'hover'];

  // Un dominio è un hostname: lettere, cifre, punti e trattini. Niente spazi,
  // niente a capo, niente slash — cioè niente frasi travestite da dominio.
  const DOMINIO_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  // I SITI CHE NON SONO SITI DI NESSUNO (#584, sesto giro).
  //
  // Il nome del sito è l'unica delle quattro cose che un percorso pubblica a
  // non poter essere ripulita: è anche l'indirizzo Firestore sotto cui il
  // documento va a finire, e cambiarlo vorrebbe dire scriverlo in un posto
  // dove nessuno lo cercherà. Quindi o esce com'è, o non esce.
  //
  // Per i siti pubblici esce com'è e lo guarda il modello che giudica, al
  // quale adesso arriva insieme alle altre tre parti. Ma c'è una famiglia per
  // cui non serve nemmeno chiederglielo: gli indirizzi che non portano da
  // nessuna parte fuori da casa di chi naviga. Il router (`192.168.1.1`), il
  // disco di rete (`nas-rossi.local`), il server di prova sulla propria
  // macchina (`localhost`), l'intranet dell'ufficio, e le pagine interne di
  // Filo, dove l'Aiuto si apre con lo stesso tasto e il nome dell'host è una
  // parola sola (`options`).
  //
  // Lì un percorso condiviso non serve a nessun altro — nessuno visiterà mai
  // quel sito — e il nome dice dove lavori o come si chiama la tua macchina.
  // Rifiutarlo non toglie niente a nessuno: è l'unico caso in cui il prezzo
  // della condivisione è tutto e il guadagno zero.
  // La lista guarda l'ultimo pezzo del nome, e tiene insieme due famiglie che
  // hanno lo stesso effetto: i suffissi delle reti private e i nomi che per
  // convenzione non esistono e non esisteranno mai su Internet (#584, settimo
  // giro). I secondi mancavano, e sono proprio quelli che si incontrano: il
  // servizio di prova sulla propria macchina si chiama `app.localhost` — così
  // lo chiamano da soli i contenitori — e il progetto in lavorazione si chiama
  // `progetto-rossi.test`, col nome del cliente dentro. `.invalid` e
  // `.example` sono riservati allo stesso modo; `.onion`, `.alt` e `.i2p` sono
  // reti anonime, dove il nome del sito È il segreto.
  const SUFFISSI_PRIVATI = new Set([
    // reti private e nomi di casa
    'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'arpa',
    // nomi riservati: non sono e non saranno mai su Internet
    'localhost', 'test', 'invalid', 'example',
    // reti anonime
    'onion', 'alt', 'i2p',
  ]);
  const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

  // Il PUNTO FINALE. Un nome di host può finire con un punto: è la forma
  // assoluta dello stesso nome e i browser la accettano, quindi `localhost.` è
  // lo stesso computer di `localhost`. Con quel punto in fondo il nome
  // «contiene un punto» e l'ultimo pezzo è vuoto: la lista qui sopra non lo
  // riconosceva più e lasciava passare quello che senza il punto fermava
  // (#584, settimo giro). Si toglie prima di ogni controllo, e si toglie
  // ovunque — anche in lettura (paths.js → segmentoDominio) — o le due strade
  // parlerebbero di due cartelle diverse per lo stesso sito.
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
    // Una parola sola non è un sito pubblico: `localhost`, `nas`, `router`, e
    // l'host delle pagine interne di Filo.
    if (!h.includes('.')) return false;
    const ultimo = h.slice(h.lastIndexOf('.') + 1);
    if (SUFFISSI_PRIVATI.has(ultimo)) return false;
    return true;
  }

  // I SEGNI CHE NON SI VEDONO. Un'etichetta che a occhio dice «Profilo» può
  // portarsi dietro una frase intera scritta con caratteri invisibili, e da lì
  // andare davanti ai due modelli che decidono se un percorso è anonimo e poi
  // finire pubblicata. Si tolgono tre famiglie:
  //   - larghezza zero e marcatori di direzione del testo;
  //   - i caratteri «tag» U+E0000-U+E007F, che sono una copia invisibile
  //     dell'alfabeto ed è con quelli che oggi si nasconde davvero del testo
  //     (#584, quinto giro: la difesa prometteva «niente segni invisibili» e
  //     proprio quelli passavano interi);
  //   - i selettori di variante U+FE00-U+FE0F.
  // La stessa famiglia la toglie SN_CONST.unaRigaDiDati, che fa questo lavoro
  // per i prompt: una sentinella negli unit test confronta le due e diventa
  // rossa se divergono.
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

  // L'intento è UNA riga: la produce un LLM e la rilegge un altro LLM dentro il
  // prompt di un'altra persona. Togliamo il wrapping markdown, teniamo la prima
  // riga, tagliamo a MAX_INTENT_LEN.
  function sanitizeIntent(text) {
    if (typeof text !== 'string') return '';
    // La frase la scrive un modello, ma leggendo gli elementi toccati e la
    // sezione di partenza: quello che ha visto lì può ricopiarlo qui dentro.
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
    // hostname senza porta e senza il punto finale della forma assoluta. Non
    // strippiamo "www." per restare letterali: chi consuma può fare il
    // matching come preferisce.
    //
    // Un nome più lungo del massimo si RIFIUTA, non si taglia: il taglio
    // arrivava prima del controllo sui siti che non sono di nessuno, e un nome
    // di duecentosessanta caratteri che finiva in «.localhost» si presentava a
    // quel controllo finendo in «.lo», che nella lista non c'è (#584, ottavo
    // giro). Oltre 253 caratteri un nome di host non è nemmeno valido.
    const h = normalizzaHost(u.hostname);
    return h.length > MAX_DOMAIN_LEN ? '' : h;
  }

  // ───────────────────── la sezione di partenza, a pezzi ────────────────────
  //
  // La query e il frammento si buttano, ma il percorso di una pagina porta
  // spesso addosso chi sei, e non solo in forma di codice: `/u/mario.rossi/
  // ordini/847362` dice il nome, e un nome utente è spesso lo stesso su più
  // siti — due percorsi che lo contengono sono della stessa persona e per di
  // più le danno un nome (#584, terzo giro). La cancellazione per forme
  // (email, IBAN, codici, numeri) non lo vede: `mariorossi` è una parola come
  // un'altra.
  //
  // Quindi il percorso si guarda PEZZO PER PEZZO, con tre regole, in quest'ordine:
  //   1. il pezzo che segue una parola che ANNUNCIA una persona (`/u/`,
  //      `/user/`, `/profilo/`, `/in/`, `/clienti/`…) è un nome: segnaposto;
  //   2. sui siti dove il nome utente è il PRIMO pezzo e non ha niente davanti
  //      (github.com/mariorossi, x.com/mariorossi), il primo pezzo è un nome:
  //      segnaposto — a meno che non sia una sezione pubblica riconoscibile
  //      (`/notifications`, `/explore`…), che lì sta per tutti;
  //   3. per tutto il resto si tolgono le FORME che identificano: email,
  //      IBAN, codici fiscali, numeri lunghi, codici esadecimali, UUID, token
  //      misti, cifre da cinque in su.
  //
  // La terza regola è per SOTTRAZIONE, e prima era per addizione: si teneva
  // solo il pezzo fatto di sole lettere e si buttava tutto il resto. Costava
  // più di quanto proteggesse (#584, quinto giro): spariva `carta-identita.html`,
  // spariva `v2`, spariva `user_settings`, e su ventisette indirizzi veri di
  // siti comuni quattro perdevano l'indirizzo per intero. Il nome di una
  // sezione, un numero di versione e un'estensione di file non dicono chi sei,
  // e toglierli non protegge nessuno — mentre un indirizzo ridotto a `/[ID]`
  // non dice più nemmeno da che punto del sito si parte, che è l'unica cosa
  // per cui chi riusa un percorso lo legge.
  const MARCATORI_PERSONA = new Set([
    'u', 'user', 'users', 'utente', 'utenti', 'profile', 'profil', 'profilo',
    'profili', 'member', 'members', 'membro', 'membri', 'people', 'persone',
    'usr', 'usuario', 'usuarios', 'benutzer', 'utilisateur', 'in', 'author', 'autore',
    'autori', 'cliente', 'clienti', 'customer', 'customers', 'perfil',
    'membres', 'mitglied',
  ]);
  // Fuori di proposito: `account`. Su quasi ogni sito `/account/...` è la
  // sezione «il tuo account», e quello che segue è una pagina (`/account/ordini`,
  // `/account/privacy`), non un nome: metterlo fra i marcatori cancellava il
  // punto di partenza più comune che ci sia.

  // `/c/` è il canale su un sito di video e la CATEGORIA su un negozio, dove
  // è anche il punto di partenza più utile che esista (`/c/scarpe-donna`).
  // Vale come marcatore solo dove indica davvero una persona.
  const MARCATORI_VIDEO = new Set(['c', 'channel', 'canale']);
  const SITI_VIDEO = new Set([
    'youtube.com', 'youtu.be', 'twitch.tv', 'kick.com', 'rumble.com',
    'odysee.com', 'dailymotion.com', 'vimeo.com',
  ]);

  // I siti dove il nome utente è il PRIMO pezzo dell'indirizzo, senza nessuna
  // parola davanti che lo annunci. Sono i casi che si vedono, non tutti quelli
  // che esistono: la rete generale resta il modello che giudica il percorso
  // prima che parta, e che vede l'indirizzo per intero.
  const SITI_COL_NOME_IN_TESTA = new Set([
    'github.com', 'gitlab.com', 'codeberg.org', 'gitee.com',
    'x.com', 'twitter.com', 'threads.net', 'bsky.app',
    'instagram.com', 'tiktok.com', 'facebook.com', 'snapchat.com',
    'medium.com', 'dev.to', 'hashnode.com', 'behance.net', 'dribbble.com',
    'soundcloud.com', 'patreon.com', 'ko-fi.com', 'twitch.tv', 'kick.com',
    'vimeo.com', 'deviantart.com', 'pinterest.com', 'about.me', 'linktr.ee',
    't.me', 'telegram.me', 'paypal.me', 'venmo.com', 'cash.app',
  ]);

  // Le sezioni pubbliche che su quei siti stanno al posto del nome utente.
  // Senza questa lista `github.com/notifications` e `instagram.com/explore`
  // uscivano tutti e due come `/[ID]`, cioè identici e inservibili — mentre
  // non dicono niente di nessuno (#584, quinto giro).
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
  // Un token opaco: lungo, lettere e cifre mescolate, senza separatori che ne
  // facciano una frase (`a1b2c3d4e5f6g7h8`). Un nome di sezione con un numero
  // dentro (`v2`, `user_settings`, `carta-identita.html`) non ci casca.
  const TOKEN_MISTO_RE = /^(?=.*[0-9])(?=.*[a-z])[a-z0-9]{12,}$/i;
  // Cifre attaccate: fino a quattro è un anno, una pagina, un indice; da cinque
  // in su è il numero di un ordine, di un conto, di una pratica.
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

  // Un pezzo di percorso, senza le forme che dicono chi sei.
  function redigiSegmento(segmento) {
    const chiaro = decodi(segmento);
    // Un pezzo che una volta decodificato contiene una barra, uno spazio o un a
    // capo non è un pezzo: è due pezzi travestiti da uno, o una frase. Tenerlo
    // cambierebbe la forma dell'indirizzo che pubblichiamo.
    if (/[\\/\s]/.test(chiaro)) return '[ID]';
    // `/@mariorossi` è il soprannome di una persona, non un indirizzo email:
    // vale come identificativo comunque, ed è la forma dei profili sui siti
    // di video e sui social nuovi.
    if (chiaro.startsWith('@')) return '[ID]';
    if (chiaro.includes('@')) return '[EMAIL]';
    const perForme = redigiDatiPersonali(chiaro);
    if (perForme !== chiaro) return perForme;
    if (UUID_RE.test(chiaro) || ESADECIMALE_RE.test(chiaro)) return '[ID]';
    if (TOKEN_MISTO_RE.test(chiaro)) return '[ID]';
    if (SOLO_CIFRE_LUNGO_RE.test(chiaro)) return '[NUMERO]';
    return chiaro;
  }

  // IL NOME CHE STA UN PEZZO PIÙ IN LÀ (#584, ottavo giro). Quando il marcatore
  // scatta, il pezzo che segue diventa un segnaposto: ma moltissimi siti mettono
  // lì un numero e SUBITO DOPO il nome scritto a lettere della stessa persona.
  // `/users/12345/mario-rossi` è la forma dei forum, dei siti di domande e
  // risposte, delle librerie sociali. Il codice sa già che lì c'è una persona,
  // e si fermava un pezzo troppo presto.
  //
  // Quindi dopo il marcatore si resta in una ZONA della persona, lunga al
  // massimo due pezzi, e dentro quella zona un pezzo che ha la FORMA di un nome
  // scritto per esteso diventa anche lui un segnaposto. La forma è: due o più
  // parole attaccate da `-`, `.` o `_` (`mario-rossi`, `rossi.mario`,
  // `12345-mario-rossi`), oppure una maiuscola in mezzo (`MarioRossi`).
  //
  // La zona si chiude al primo pezzo che quella forma non ce l'ha, che è come
  // `/user/mariorossi/comments/abc` tiene «comments» e `/utenti/123/rossi-mario/
  // documenti` tiene «documenti». Una parola sola tutta minuscola non si
  // distingue dal nome di una sezione e resta: lì la rete è il modello che
  // giudica, come per tutti gli altri siti.
  const NOME_PER_ESTESO_RE = /^(?:\d+[-_.])?[A-Za-z][A-Za-z]*(?:[-_.][A-Za-z][A-Za-z]*)+$|^[a-z]+[A-Z][a-z]+/;

  // LE PAROLE CHE FANNO UNA SEZIONE, NON UN COGNOME (#584, nono giro).
  //
  // La forma da sola non distingue `mario-rossi` da `note-spese`: sono due
  // parole attaccate da un trattino tutte e due. E le sezioni delle aree
  // personali si chiamano PROPRIO così, perché stanno dietro allo stesso
  // marcatore che annuncia la persona: `/clienti/12345/note-spese`,
  // `/utenti/12345/ordini-recenti`, `/users/12345/change-password`. Così il
  // punto di partenza usciva `/clienti/[ID]/[ID]`, cioè non diceva più da dove
  // si parte, che è l'unica cosa per cui chi riusa un percorso lo legge: la
  // regola che il quinto giro aveva scritto, riaperta da una porta nuova.
  //
  // Quindi dentro la zona la forma non basta: si guardano anche le PAROLE del
  // pezzo. Le due risposte provate prima di questa erano tutte e due sbagliate,
  // e in direzioni opposte. Bastava UNA parola da sezione, in qualunque punto,
  // a salvare tutto il pezzo: usciva il cognome che le stava accanto
  // (`rossi-fatture`, `bianchi-ordini`, #584 decimo giro). Serviva che TUTTE le
  // parole fossero da sezione: sparivano le sezioni vere, perché quasi tutte
  // hanno accanto una parola che nella lista non c'è (`fatture-elettroniche`,
  // `ordini-annullati`, `order-tracking`: quattordici su ventidue indirizzi
  // veri di aree personali, #584 undicesimo giro).
  //
  // La domanda giusta non è sul pezzo, è sulla POSIZIONE (vedi
  // `redigiNellaZona`): il pezzo tiene le parole da sezione finché ne trova, e
  // dalla prima parola che non lo è in poi resta un segnaposto. Il nome sta
  // sempre dalla parte del segnaposto, la sezione resta leggibile.
  //
  // Gli articoli, le preposizioni e i possessivi stanno nella lista e devono:
  // `metodi-di-pagamento` e `my-orders` sono sezioni per intero, e `di` da solo
  // non salva più niente perché `mario-di-rossi` comincia con una parola che
  // nella lista non c'è. Restano fuori `carta` e `piano`, che sono cognomi
  // italiani veri, e non ne hanno bisogno per restare quando stanno da soli.
  //
  // La lista tiene parole che un nome o un cognome non sono, in italiano e in
  // inglese (più i pochi termini spagnoli e francesi che si incontrano).
  const PAROLE_DI_SEZIONE = new Set([
    // articoli, preposizioni, possessivi: da soli non dicono niente, e senza di
    // loro `metodi-di-pagamento` e `i-miei-ordini` non sarebbero sezioni intere
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

  // UN PEZZO DENTRO LA ZONA DELLA PERSONA (#584, undicesimo giro).
  //
  // Tiene le parole da sezione FINCHÉ ne trova; dalla prima parola che una
  // sezione non è in poi, un segnaposto solo. Se la prima parola già non lo è,
  // del pezzo non resta niente.
  //
  //   fatture-elettroniche → fatture-[ID]     (si sa ancora da dove si parte)
  //   note-spese           → note-spese       (nessuna parola sospetta)
  //   rossi-fatture        → [ID]             (il cognome apre il pezzo)
  //   mario-nuovo          → [ID]             (e «nuovo» non lo salva)
  //   mariorossi           → [ID]
  //   ordini               → ordini
  //
  // Il nome finisce sempre dalla parte del segnaposto: una parola che nella
  // lista non c'è può essere un cognome, e tutto ciò che la segue se ne va con
  // lei. Quello che resta leggibile sono solo parole che un nome non è.
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

  // Il pezzo ha la FORMA di un nome per esteso? Serve solo dal secondo pezzo
  // della zona in poi: là un pezzo che quella forma non ce l'ha è quasi sempre
  // il nome di una sezione, e passa dalla pulizia normale come prima. Il primo
  // pezzo dopo il marcatore non passa di qui: là il nome ci sta sempre, e la
  // domanda la fa `redigiNellaZona` su ogni forma.
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
        // Il primo pezzo dopo il marcatore era un segnaposto e basta, anche
        // quando era il nome della sezione: `/utente/ordini` e
        // `/utente/preferiti` arrivavano tutti e due «da /utente/[ID]», e chi
        // legge non aveva più niente con cui scegliere fra i due (#584, decimo
        // e undicesimo giro).
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

  // Per il matching futuro vogliamo URL "stabili": teniamo il path (no query,
  // no hash) perché query e fragment di solito contengono parametri specifici
  // dell'utente o stato di UI; il path invece identifica la sezione del sito.
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

  // `domain` serve per la seconda regola (i siti col nome in testa) quando qui
  // arriva un percorso già senza host: è il caso della RI-lettura di un
  // documento vecchio, e senza il dominio quella regola non saprebbe applicarsi.
  function sanitizeInitialUrl(raw, domain) {
    // Accetta sia un URL intero (lo riduce al path) sia un path già normalizzato.
    const s = String(raw || '').trim();
    if (!s) return '/';
    if (/^https?:\/\//i.test(s)) return normalizedPath(s) || '/';
    const ripulito = neutralizzaMarcature(s).trim().replace(/\s+/g, '');
    if (!ripulito.startsWith('/')) return '/';
    return redigiPercorso(ripulito, domain || '').slice(0, MAX_URL_LEN) || '/';
  }

  // LA pulizia: quella che il client applica prima di inviare e che il server
  // RIAPPLICA prima di scrivere. Ritorna { ok, doc } oppure { ok:false, reason }.
  //
  // NEL DOCUMENTO NON C'È NIENTE DEL MITTENTE (audit pre-alpha, #584). Non il
  // `clientId`, che serve al server come identità per i limiti di frequenza e
  // viaggia ACCANTO al documento; e nemmeno lo `userAgent`, che c'era e non lo
  // leggeva nessuno: la raccolta è leggibile da chiunque, e sistema operativo
  // più versione più lingua bastavano a rimettere insieme i percorsi della
  // stessa installazione su domini diversi. Per riusare un percorso non serve
  // sapere chi l'ha fatto.
  //
  // `domain` resta nel documento come dato di comodo, ma non è più lui a
  // decidere dove il documento va a finire: il dominio è un SEGMENTO del
  // percorso Firestore (`paths/<dominio>/entries`), ed è così che una lettura
  // può chiedere un sito solo invece della raccolta intera (firestore.rules →
  // match /paths/{domain}).
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

  // Impacchetta i percorsi per il messaggio di sistema dell'agente Aiuto.
  // Ritorna '' se non c'è niente da mostrare — così il prompt non apre un
  // blocco vuoto. Ogni campo ripassa dalla pulizia: i documenti già nella
  // raccolta possono essere nati quando scriverli non richiedeva niente.
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
      // Un percorso senza passi non insegna niente: sarebbe solo una frase di
      // ignoto autore dentro il prompt di qualcun altro.
      if (!steps.length) continue;
      const intent = sanitizeIntent(p.intent) || '(intento ignoto)';
      const init = sanitizeInitialUrl(p.initialUrl, p.domain);
      const header = `## "${intent}" (da ${init})`;
      const stepLines = steps.map((s, i) =>
        `  ${i + 1}. ${s.action} su ${s.selector}${s.retracted ? ' [poi corretto]' : ''}`);
      let block = [header, ...stepLines].join('\n');
      // Nessun percorso da solo si prende più di una fetta del tetto: trenta
      // passi con etichette lunghe fanno un blocco da quindicimila caratteri,
      // e tutti gli altri percorsi di quel dominio resterebbero fuori. Quello
      // che non ci sta si taglia dicendolo, invece di sparire in silenzio.
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
      // Il percorso che non ci sta si SALTA, non chiude la fila: fermarsi al
      // primo buttava via anche tutti quelli dopo, che nel tetto ci stavano.
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
    // Vale nei due sensi: un sito che non si condivide non si legge nemmeno,
    // o un percorso depositato sotto `localhost` tornerebbe a chiunque apra
    // l'Aiuto su una pagina locale (src/shared/paths.js → segmentoDominio).
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
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
