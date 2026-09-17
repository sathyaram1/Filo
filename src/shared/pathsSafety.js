// I percorsi condivisi: unico contenuto scritto da un utente e letto nel prompt di altri.
// Chi scrive passa da `sanitizeSubmission`: la applica il client e la RIAPPLICA il server.
// In lettura i percorsi ripassano dalla pulizia: nella raccolta ci sono documenti vecchi.

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

  // Delimitano il blocco nel messaggio di sistema: il testo dei percorsi non può contenerle,
  // o un intento che scrive la chiusura farebbe credere al modello che il resto è suo.
  const FENCE_START = '<<<PERCORSI_CONDIVISI>>>';
  const FENCE_END = '<<<FINE_PERCORSI_CONDIVISI>>>';

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
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

  // Toglie ciò che in un testo diretto al prompt servirebbe solo a fingerne la struttura:
  // controlli, a capo (ogni campo è una riga sola), sequenze di < o > e le marcature.
  function neutralizzaMarcature(testo) {
    return String(testo == null ? '' : testo)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/[\r\n\u2028\u2029]+/g, ' ')
      .replace(INVISIBILI_RE, '')
      .replace(/<{2,}/g, '<')
      .replace(/>{2,}/g, '>')
      .replace(/PERCORSI_CONDIVISI/gi, 'percorsi-condivisi');
  }

  // Cancella i dati personali da OGNI campo che esce dal computer di chi naviga.
  // L'ordine conta: prima le forme con lettere e cifre, poi le cifre, o l'IBAN si spezza.
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

  // L'intento è UNA riga: lo scrive un LLM e lo rilegge un altro LLM dentro il prompt di
  // un'altra persona.
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

  // La applica il client prima di inviare e la RIAPPLICA il server prima di scrivere.
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

  // Impacchetta i percorsi per il messaggio di sistema dell'Aiuto; '' se non c'è niente da
  // mostrare. Ogni campo ripassa dalla pulizia: nella raccolta ci sono documenti vecchi.
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
