// I controlli che fermano un avviso (#536) o un'uscita (#810) SENZA chiedere a nessun modello: l'unico posto delle forme dei segreti.
// Devono funzionare a rete staccata e sbagliare di rado: solo forme che non hanno nessuna ragione
// di comparire in un testo onesto. Prove: tests/unit/guardianoStatico.test.mjs, usciteSegreti.test.mjs.

(function (global) {
  'use strict';

  // Un segreto più corto di così è una parola, non una chiave: confrontarlo
  // fermerebbe avvisi innocui che la contengono per caso.
  const SEGRETO_MIN = 12;
  // Una password nota come tale (#2134) la sceglie l'utente, e 8-11 caratteri sono comuni: lì la soglia scende.
  const PASSWORD_MIN = 8;

  // Chi custodisce una password la segna qui: vale col suo minimo anche dove arriva come semplice stringa.
  const PASSWORD_NOTE = new Set();
  function segnaPassword(v) {
    const t = testo(v).trim();
    if (t.length >= PASSWORD_MIN && PASSWORD_NOTE.size < 1000) PASSWORD_NOTE.add(t);
  }

  // Un segreto è una stringa o { valore, password }.
  function segretoDi(x) {
    const oggetto = !!x && typeof x === 'object';
    const v = testo(oggetto ? x.valore : x).trim();
    return { v, min: (oggetto && x.password) || PASSWORD_NOTE.has(v) ? PASSWORD_MIN : SEGRETO_MIN };
  }

  // Qui NON si indovina se un codice è una credenziale: si riconoscono solo le
  // forme che in una frase onesta non compaiono. Un codice «di verifica», «di
  // accesso», «di conferma» descrive quasi sempre un portone, una
  // prenotazione, un wifi o una SIM, e sette giri di correzioni hanno mostrato
  // che l'elenco delle cose innocue non finisce mai: quelle frasi le legge il
  // guardiano, che vede la frase intera. Qui restano i marchi del codice
  // MONOUSO, che nessuno usa per il cancello di casa (#536): il nome del codice col suo senso, anche oltre un
  // complemento («codice di sicurezza monouso») o una parola («two-factor authentication code»).
  // Ogni ripetizione ha un tetto: su un token di milioni di caratteri una regex senza tetto finiva la pila e
  // la porta delle uscite si fermava (#1505). Prova: tests/unit/usciteSegreti.test.mjs.
  const NOME_CODICE = '(?:codic\\w{0,20}|chiav[ei]|passwords?|passphrases?|passcodes?|codes?|pins?)';
  const SENSO_MONOUSO = '(?:recupero|ripristino|backup|temporane\\w{1,20}|temporary|monouso|usa\\s+e\\s+getta|recovery'
    + '|one[\\s-]?time|single[\\s-]?use|(?:a|in)\\s+due\\s+(?:fattori|passaggi)|two[\\s-]?(?:factor|step))';
  const PAROLA = "[\\wÀ-ÿ'’-]{1,64}";
  const MARCHI_MONOUSO = new RegExp(
    '(?:\\b(?:otp|mfa|2fa)\\b(?:\\s+(?:codes?|codice|pin))?'
    + `|\\b${NOME_CODICE}(?:\\s+(?:di|da|per)\\s+${PAROLA})?\\s+(?:di\\s+|da\\s+)?${SENSO_MONOUSO}\\b`
    + `|\\b${SENSO_MONOUSO}(?:\\s+${PAROLA})?\\s+${NOME_CODICE}\\b`
    // «Recovery key», il nome di Apple: «key» da sola è troppo comune per stare fra i nomi del codice.
    + '|\\brecovery\\s+keys?\\b)',
    'i',
  );

  // La forma di un codice: cifre, blocchi separati da trattino come nei codici
  // di recupero, o lettere e cifre mescolate come in una password.
  const CIFRE = '\\d{4,10}';
  const BLOCCHI = '[A-Za-z0-9]{4,6}(?:[-\\s][A-Za-z0-9]{4,6}){1,5}';
  const MISTO = '(?=[A-Za-z0-9]{6,24}\\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\\d)[A-Za-z0-9]{6,24}';
  const FORMA_CODICE = new RegExp(`\\b(?:${CIFRE}|${BLOCCHI}|${MISTO})\\b`);

  // Quanto lontano dalla parola si cerca la forma: una riga scarsa.
  const RAGGIO = 60;

  // L'inizio fisso di una chiave privata pkcs8 in base64 senza intestazione (EC P-256 con e senza la pubblica, P-384,
  // RSA, Ed25519): così la salvano le librerie, e così è la chiave dei feedback (#1507).
  const INIZI_PKCS8 = [
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg',
    'MEECAQAwEwYHKoZIzj0CAQYIKoZIzj0DAQcEJzAlAgEBBCA',
    'MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDA',
    'MII[A-Za-z0-9+/]{3}IBADANBgkqhkiG9w0BAQEFAASC[A-Za-z0-9+/]{3}wgg[A-Za-z0-9+/]{2}AgEAAoI',
    'MC4CAQAwBQYDK2VwBCIEI',
  ];

  // Le chiavi si riconoscono dal prefisso che il loro emittente ci mette
  // apposta: cercare «stringa lunga e casuale» prenderebbe mezzo web.
  // Una chiave vera sta in poche centinaia di caratteri: il corpo si legge fino a MAX_TOKEN, e il gruppo dopo dice
  // che il token prosegue. Lì il testo è costruito apposta e chi controlla un'uscita lo tratta da saturo.
  const MAX_TOKEN = 1024;
  const FORME_CHIAVE = [
    ['\\bsk-', '[A-Za-z0-9_-]', 16],
    ['\\b(?:sk|pk|rk)_(?:live|test)_', '[A-Za-z0-9]', 10],
    ['\\bgh[pousr]_', '[A-Za-z0-9]', 20],
    ['\\bgithub_pat_', '[A-Za-z0-9_]', 20],
    ['\\bxox[baprs]-', '[A-Za-z0-9-]', 10],
    ['\\bAIza', '[A-Za-z0-9_-]', 20],
    ['\\bAKIA', '[A-Z0-9]', 12],
    ['\\bglpat-', '[A-Za-z0-9_-]', 20],
    ['\\btvly-', '[A-Za-z0-9_-]', 16],
    // JWT: intestazione e dichiarazioni possono superare MAX_TOKEN (i token aziendali con molti gruppi), la firma no.
    ['\\beyJ[A-Za-z0-9_-]{10,8192}\\.eyJ[A-Za-z0-9_-]{10,8192}\\.', '[A-Za-z0-9_-]', 10],
  ].map(([testa, corpo, min]) => new RegExp(`${testa}${corpo}{${min},${MAX_TOKEN}}(${corpo})?`))
    .concat([
      /-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----/,
      // Le righe di un PEM vanno a capo ogni 64 caratteri: la chiave resta una.
      new RegExp(`\\b(?:${INIZI_PKCS8.join('|')})(?:[A-Za-z0-9+/]|\\r?\\n(?=[A-Za-z0-9+/])){20,}`),
    ]);

  // Il pezzo che ogni chiave dello stesso tipo ha uguale: dice di che tipo è, non quale. Di un JWT lo sono intestazione e
  // dichiarazioni (l'emittente e la chiave di firma sono quelli di tutti): il segreto è la firma.
  const PREFISSO_FISSO = new RegExp(`^(?:-----BEGIN [A-Z ]*PRIVATE KEY-----\\s*)?(?:${[
    'sk-(?:or-v1-|ant-api\\d\\d-|proj-)?', '(?:sk|pk|rk)_(?:live|test)_', 'gh[pousr]_', 'github_pat_', 'xox[baprs]-', 'AIza', 'AKIA',
    'glpat-', 'tvly-(?:dev-)?', ...INIZI_PKCS8, 'eyJ[\\w-]*\\.eyJ[\\w-]*\\.',
  ].join('|')})?`);
  const CODA_FISSA = /\s*-----END [A-Z ]*PRIVATE KEY-----\s*$/;

  const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4}\b/g;
  const CARTA_RE = /\b(?:\d[ -]?){13,19}\b/g;

  function testo(v) {
    return String(v == null ? '' : v);
  }

  // Mod-97 dell'IBAN: senza questa verifica un codice prodotto qualunque di
  // venti caratteri passerebbe per coordinata bancaria.
  function ibanValido(raw) {
    const s = raw.replace(/\s/g, '').toUpperCase();
    if (s.length < 15 || s.length > 34) return false;
    const ruotato = s.slice(4) + s.slice(0, 4);
    let resto = 0;
    for (const ch of ruotato) {
      const n = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      if (!/^\d+$/.test(n)) return false;
      for (const d of n) resto = (resto * 10 + Number(d)) % 97;
    }
    return resto === 1;
  }

  function luhn(raw) {
    const s = raw.replace(/[\s-]/g, '');
    if (!/^\d{13,19}$/.test(s)) return false;
    let somma = 0;
    let doppio = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let n = Number(s[i]);
      if (doppio) { n *= 2; if (n > 9) n -= 9; }
      somma += n;
      doppio = !doppio;
    }
    return somma % 10 === 0;
  }

  // Una carta ha la forma del suo circuito: prefisso e lunghezza, oltre alla cifra di controllo. Quella da
  // sola la passa un numero lungo su dieci: un video, un ordine, un istante nei log.
  function cartaValida(raw) {
    const s = String(raw || '').replace(/[\s-]/g, '');
    if (!luhn(s)) return false;
    const n = s.length;
    const p = (k) => Number(s.slice(0, k));
    if (s[0] === '4') return n === 13 || n === 16 || n === 19;
    if ((p(2) >= 51 && p(2) <= 55) || (p(4) >= 2221 && p(4) <= 2720)) return n === 16;
    if (p(2) === 34 || p(2) === 37) return n === 15;
    if (p(2) === 36 || p(2) === 38 || p(2) === 39 || (p(3) >= 300 && p(3) <= 305)) return n >= 14;
    if ((p(4) >= 3528 && p(4) <= 3589) || p(4) === 6011 || p(2) === 62 || p(2) === 65 || (p(3) >= 644 && p(3) <= 649)) return n >= 16;
    return (p(2) === 50 || (p(2) >= 56 && p(2) <= 69)) && n >= 12;
  }

  // L'host che una scritta NOMINA, se ne nomina uno: un indirizzo intero o un
  // nome di dominio scritto in chiaro.
  function hostNominato(etichetta) {
    const s = testo(etichetta);
    const url = s.match(/\bhttps?:\/\/[^\s<>"']+/i);
    if (url) { const h = hostDi(url[0]); if (h) return h; }
    const nudo = s.match(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/i);
    return nudo ? nudo[0].toLowerCase().replace(/^www\./, '') : '';
  }

  function hostDi(url) {
    try {
      return new URL(testo(url)).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) { return ''; }
  }

  // La coda è il sito: `accedi.banca.it` sotto la scritta `banca.it` è onesto,
  // `banca.it.altrove.invalid` no (patterns/un-collegamento-dice-dove-porta.md).
  function stessoSito(a, b) {
    if (!a || !b) return true;
    if (a === b) return true;
    return a.endsWith('.' + b) || b.endsWith('.' + a);
  }

  // I collegamenti che il testo porta con sé: quelli in forma markdown, che è
  // come arrivano i testi di un modello.
  function linkNelTesto(s) {
    const out = [];
    const re = /\[([^\]\n]{1,200})\]\(\s*([^\s)]{1,500})\s*\)/g;
    let m;
    while ((m = re.exec(testo(s)))) out.push({ etichetta: m[1], url: m[2] });
    return out;
  }

  // `motivo` è la coda della riga che legge l'utente e non riporta mai un pezzo
  // del testo esaminato: quello lo scrive chi attacca.
  function controlla(testoAvviso, { segreti = [], link = [] } = {}) {
    const s = testo(testoAvviso);
    const no = { blocca: false, regola: '', motivo: '' };
    if (!s.trim() && !link.length) return no;

    for (const seg of segreti) {
      const { v, min } = segretoDi(seg);
      if (v.length >= min && s.includes(v)) {
        return { blocca: true, regola: 'segreto', motivo: 'conteneva un segreto che custodisco io' };
      }
    }

    for (const re of FORME_CHIAVE) {
      if (re.test(s)) {
        return { blocca: true, regola: 'chiave', motivo: 'conteneva quella che sembra una chiave di accesso' };
      }
    }

    // Tutte le occorrenze, non la prima: la parola che conta può essere la
    // terza, e fermarsi alla prima lascia passare il resto della mail.
    const cerca = new RegExp(MARCHI_MONOUSO.source, 'gi');
    let parola;
    while ((parola = cerca.exec(s))) {
      const i = parola.index;
      const prima = s.slice(Math.max(0, i - RAGGIO), i);
      const dopo = s.slice(i + parola[0].length, i + parola[0].length + RAGGIO);
      if (FORMA_CODICE.test(prima) || FORMA_CODICE.test(dopo)) {
        return { blocca: true, regola: 'codice', motivo: 'conteneva un codice usa e getta' };
      }
    }

    for (const m of s.match(IBAN_RE) || []) {
      if (ibanValido(m)) {
        return { blocca: true, regola: 'iban', motivo: 'conteneva coordinate bancarie' };
      }
    }
    for (const m of s.match(CARTA_RE) || []) {
      if (cartaValida(m)) {
        return { blocca: true, regola: 'carta', motivo: 'conteneva quello che sembra il numero di una carta' };
      }
    }

    for (const l of linkNelTesto(s).concat(Array.isArray(link) ? link : [])) {
      const mostrato = hostNominato(l && l.etichetta);
      const reale = hostDi(l && l.url);
      if (mostrato && reale && !stessoSito(mostrato, reale)) {
        return { blocca: true, regola: 'link', motivo: 'conteneva un collegamento che non porta dove dice' };
      }
    }

    return no;
  }

  // ── I segreti dentro un testo letto da fuori (#810) ──────────────────────
  // Stesse forme di `controlla`, ma qui servono i VALORI: l'uscita che li contiene si ferma.
  // Per i codici conta solo ciò che la sua parola annuncia, così un telefono, una data o
  // un numero d'ordine sparsi nella pagina non diventano segreti.

  // Blocchi prima delle cifre: «7563 0192» è un codice di recupero, non due numeri; «482 913» è
  // un codice monouso scritto a gruppi, come lo mostrano molte app.
  const TERNE = '\\d{3}[ -]\\d{3}';
  const CANDIDATO = new RegExp(`\\b(?:${BLOCCHI}|${MISTO}|${TERNE}|${CIFRE})\\b`, 'g');
  const PEZZO_CODICE = new RegExp(`^(?:${CIFRE}|${MISTO}|[A-Za-z0-9]{4,6}(?:-[A-Za-z0-9]{4,6}){1,5})$`);
  // Fra due codici di un elenco ci sono a capo, spazi, puntini o numeri di riga: una parola
  // in mezzo vuol dire che il numero dopo parla d'altro.
  const FRA_CODICI = /^[\s\d.,;:)(•·*-]{0,40}$/;
  // Valori diversi, non ripetizioni. Largo: una pagina onesta non ci arriva, e la memoria resta limitata anche su
  // milioni di caratteri. Oltre, il testo è costruito apposta: si smette e lo si dice (`saturo`, vedi segretiNelTesto).
  const MAX_ESTRATTI = 100000;

  // Raccoglie senza doppioni: righe ripetute non consumano il tetto che serve al codice vero.
  function raccolta() {
    const valori = [];
    const chiavi = new Set();
    return {
      valori,
      saturo: false,
      push(...xs) {
        for (const x of xs) {
          const k = `${x.regola}:${x.valore.toLowerCase()}`;
          if (chiavi.has(k)) continue;
          if (valori.length >= MAX_ESTRATTI) { this.saturo = true; continue; }
          chiavi.add(k);
          valori.push(x);
        }
        return valori.length;
      },
    };
  }

  // Un anno o un pezzo di data, ora o importo («30/09/2026», «1234,50») non è un codice.
  function pezzoDiData(s, i, j, v) {
    if (/^(?:19|20)\d{2}$/.test(v)) return true;
    return /\d[/.:,]$/.test(s.slice(Math.max(0, i - 2), i)) || /^[/.:,]\d/.test(s.slice(j, j + 2));
  }

  // I pezzi di un candidato che hanno la forma di un codice, più le coppie vicine: un codice
  // di recupero «7563 0192» può uscire anche come «75630192». `da` è dove comincia il primo: i
  // blocchi di sole lettere davanti («codes», «vedi ticket») sono parole, non l'inizio del codice.
  function pezzi(s, m) {
    if (/^\d{3}[ -]\d{3}$/.test(m[0])) {
      return pezzoDiData(s, m.index, m.index + m[0].length, m[0]) ? { da: m.index, out: [] } : { da: m.index, out: [m[0].replace(/[ -]/, '')] };
    }
    const out = [];
    const re = /\S+/g;
    let t;
    let prima = null;
    let da = -1;
    while ((t = re.exec(m[0]))) {
      const i = m.index + t.index;
      const j = i + t[0].length;
      const buono = PEZZO_CODICE.test(t[0]) && !pezzoDiData(s, i, j, t[0]);
      if (buono) {
        if (da < 0) da = i;
        out.push(t[0]);
        if (prima && prima.j + 1 === i) out.push(s.slice(prima.i, j));
      }
      prima = buono ? { i, j } : null;
    }
    return { da, out };
  }

  // Tutti i candidati del testo in una passata sola: cercarli di nuovo per ogni parola rendeva
  // il costo quadratico, e una pagina lunga sul 2FA teneva fermo il processo per secondi.
  function candidatiDi(s) {
    const out = [];
    const re = new RegExp(CANDIDATO.source, 'g');
    let m;
    while ((m = re.exec(s))) {
      const p = pezzi(s, m);
      if (p.out.length) out.push({ i: p.da, j: m.index + m[0].length, v: s.slice(p.da, m.index + m[0].length), pezzi: p.out });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  // Il codice è quello che la parola annuncia: un attacco («è», «:», un «=» da solo) e al più parole che
  // lo precisano, mai dentro un indirizzo né dopo una virgola che apre altro. Dopo quelle parole i due
  // punti annunciano la parola che li precede: lì «1500» o «BENVENUTO10» sono altro. `stretto`: solo l'attacco,
  // e che ci sia: «Password dimenticata?» non annuncia niente.
  // Le parole che annunciano il dato dopo il suo nome, in tutte le lingue delle etichette: un elenco solo per guardiano,
  // correttore e pavimento (#1403.33, sentinella tests/unit/annunciUnElenco.test.mjs). Nessuna va protetta in una regex.
  const ANNUNCI = Object.freeze(['è', "e'", 'e’', 'é', 'era', 'sarebbe', 'sarà', 'is', 'are', 'was', 'sono', 'ecco', 'here',
    'vale', 'risulta', "c'est", 'c’est', 'est', 'était', 'etait', 'sera', 'ist', 'lautet', 'war', 'wird', 'es', 'será',
    'serà', 'serão', 'luidt', 'jest', 'brzmi', 'będzie', 'это', 'был', 'была', 'было', 'были', 'будет', 'является',
    'είναι', 'ήταν', 'هي', 'هو', 'היא', 'הוא', 'diventa', 'diventerà', 'resta', 'resterà', 'rimane', 'rimarrà', 'sia',
    'fosse', 'essere', 'becomes', 'remains', 'stays', 'be']);
  // Un annuncio come parola intera, per le regex col flag `u`.
  const ANNUNCIO = `(?<![\\p{L}\\p{N}])(?:${ANNUNCI.join('|')})(?![\\p{L}\\p{N}])`;
  // Le parole che dopo «password» ne dicono una proprietà, non il valore («password manager», «password policy»): un elenco
  // solo per le etichette del pavimento e per la password detta prima del suo nome (riservatiNelTesto.js, #2695.8).
  // «password field: …» o «password hash: …» restano etichette: lì il valore c'è davvero.
  const PROPRIETA_PASSWORD = 'managers?|policy|reset|recovery|generator|hint|strength';
  // L'annuncio con un modale davanti e un avverbio prima o dopo («dovrebbe essere», «will be», «è ancora», #2678.7): il
  // valore sta dopo di lui come dopo «è». Spazi senza a capo; il confine lo mette chi lo usa.
  const AVVERBI = 'sempre|ancora|ora|adesso|invece|attualmente|tuttora|già|anche|comunque|proprio|pure|di[^\\S\\n]+nuovo|now|still|always|currently|also|just|actually|again';
  const MODALI = 'dovrebbe|potrebbe|deve|dovrà|può|potrà|should|must|might|could|would|will|may|can|shall';
  // Anche al passato e nei tempi composti («è diventata», «è stata cambiata in», «has been», «was set to», #2678.7), e
  // dopo chi l'ha cambiata («ho cambiato la password in …»): il verbo di cambio vale solo con «in», «a» o «to» dopo.
  const SP = '[^\\S\\n]+';
  const AUSILIARI = "è|e'|e’|é|era|sarà|sarebbe|fosse|sia|ha|aveva|avrà|has|had|have|was|is|will";
  const PARTICIPI = 'stat[ao]|diventat[ao]|divenut[ao]|rimast[ao]|restat[ao]|been|become';
  const PASSATI = 'diventò|divenne|rimase|restò|became|become|remained|stayed';
  // Un elenco solo dei verbi di cambio, anche per il correttore (#1403.67): «sostituita con», «changé en», «cambiada a».
  const CAMBI = 'cambiat[ao]|impostat[ao]|modificat[ao]|aggiornat[ao]|reimpostat[ao]|sostituit[ao]|rimpiazzat[ao]|settat[ao]|passat[ao]|messa|messo'
    + '|changed|set|updated|reset|replaced|chang[ée]e?|modifi[ée]e?|cambiad[ao]|modificad[ao]|actualizad[ao]|mudad[ao]';
  // Dopo chi l'ha cambiata la preposizione porta al valore nuovo, anche «da … a …» e «con …»; in tedesco il verbo
  // viene dopo il valore («das Passwort in «…» geändert»).
  const VERSO = 'in|a|to|into|con|with|da|from|en|à|por';
  const CAMBIO = `(?:${CAMBI})${SP}(?:in|a|to)`;
  const AUSILIARE = `(?:${AUSILIARI})${SP}(?:(?:${AVVERBI})${SP})?`;
  const CAMBIO_PRIMA = `(?:(?:${VERSO})(?<=(?<![A-Za-zÀ-ÿ])(?:${CAMBI})${SP}[^\\n.!?«»"“”„]{1,40}(?:${VERSO}))`
    + `|(?:in|auf|zu)(?=[^\\n]{1,82}?${SP}(?:geändert|gesetzt|aktualisiert)(?![A-Za-zÀ-ÿ])))`;
  const VERBO_LARGO = `(?:(?:${AUSILIARE})?(?:(?:${PARTICIPI})${SP})?${CAMBIO}|${AUSILIARE}(?:${PARTICIPI})|${PASSATI}|${ANNUNCI.join('|')})`;
  const ANNUNCIO_LARGO = `(?:${CAMBIO_PRIMA}|(?:(?:${AVVERBI})${SP})?(?:dev['’]|(?:${MODALI})${SP})?${VERBO_LARGO}(?:${SP}(?:${AVVERBI})){0,2})`;
  // Di cosa è la password, fra il nome e il valore («la password del wifi», «la pass per il router»): lo stesso per il
  // pavimento e per il correttore. Senza spazi ai lati: li mette chi lo usa.
  const COMPLEMENTO = "(?:(?:del(?:la|lo)?|di|per|for|of)[ \\t]+|dell['’][ \\t]*)(?:(?:il|la|lo|the|my|your|our|mio|mia|tuo|tua)[ \\t]+)?[A-Za-z0-9\\u00C0-\\u024F\\u0400-\\u052F][A-Za-z0-9\\u00C0-\\u024F\\u0400-\\u052F_-]{0,30}";
  // Fra l'annuncio e il dato un avverbio o il participio di un tempo composto non spostano il dato: «il pin è ancora
  // 4821», «the pin is still 4821», «è sempre stato 4821» (#2678.9). Un elenco solo, come ANNUNCI; prove in
  // tests/unit/avverbiDopoAnnuncio.test.mjs.
  const AVVERBI_DEL_DATO = Object.freeze(['ancora', 'sempre', 'ora', 'adesso', 'attualmente', 'tuttora', 'già', 'gia', 'invece',
    'comunque', 'di nuovo', 'stato', 'stata', 'now', 'still', 'always', 'currently', 'actually', 'just', 'already',
    'toujours', 'maintenant', 'actuellement', 'encore', 'déjà', 'siempre', 'ahora', 'todavía', 'todavia', 'actualmente',
    'aún', 'aun', 'ya', 'agora', 'ainda', 'atualmente', 'já', 'jetzt', 'immer', 'noch', 'aktuell', 'nun', 'weiterhin',
    'nu', 'altijd', 'nog', 'steeds', 'teraz', 'zawsze', 'nadal', 'wciąż', 'wciaz', 'już']);
  const AVVERBIO = `(?:${AVVERBI_DEL_DATO.map((w) => w.replace(/ /g, '\\s+')).join('|')})`;
  const AVVERBI_DOPO_ANNUNCIO = new RegExp(`(${ANNUNCIO})((?:\\s+${AVVERBIO}(?![\\p{L}\\p{N}])){1,3})(?=\\s+\\S)`, 'giu');
  // Il testo con quegli avverbi letti come spazi della stessa lunghezza, così ogni posto trovato vale nel testo vero; con
  // `stessaLunghezza: false` tolti, per chi cerca il dato a pochi spazi dal verbo e guarda solo i valori.
  function avverbiComeSpazi(s, { stessaLunghezza = true } = {}) {
    const t = String(s == null ? '' : s);
    return t.replace(AVVERBI_DOPO_ANNUNCIO, (_, a, resto) => a + (stessaLunghezza ? resto.replace(/\S/g, ' ') : ''));
  }
  // Il valore nuovo detto da un verbo di cambio invece che da «è» («il pin diventa …», «è stata cambiata in …», «ho
  // cambiato il pin in …»): #1403.67, #2714. Parole intere. Il valore detto dopo la domanda ha la regola sua, nel pavimento.
  const VERBI_CAMBIO = Object.freeze({
    diventa: Object.freeze(['diventa', 'diventano', 'diventerà', 'diventata', 'diventato', 'resta', 'resterà', 'rimane',
      'rimarrà', 'rimasta', 'rimasto', 'becomes', 'became', 'become', 'remains', 'stays', 'will be']),
    participi: Object.freeze(['cambiata', 'cambiato', 'modificata', 'modificato', 'aggiornata', 'aggiornato', 'impostata',
      'impostato', 'reimpostata', 'reimpostato']),
    verso: Object.freeze(['in', 'a']),
    // In inglese il valore nuovo lo porta «to»: «changed my PIN in 2024» dice quando (#2714).
    participiInglesi: Object.freeze(['changed', 'updated', 'set', 'reset']),
    versoInglese: Object.freeze(['to', 'into']),
    // Il valore detto dopo il cambio, con «ora» o in una frase a parte: «il pin è ora …», «ho cambiato il pin, ora è …».
    ora: Object.freeze(['ora', 'adesso', 'now']),
    dopo: Object.freeze(['ora è', "ora e'", 'adesso è', "adesso e'", 'è ora', 'è adesso', 'è', "e'", 'il nuovo è',
      'la nuova è', 'quello nuovo è', 'quella nuova è', 'now it is', "now it's", 'now it’s', 'now is', 'it is now',
      "it's now", 'it is', "it's", 'the new one is']),
  });
  // CAMBIO_VALORE è il pezzo fra il nome del dato e il valore, spazi davanti compresi, per regex con o senza i flag `u` e `i`:
  // una regola sola per pavimento, guardiano e uscite. «In», «a», «to» valgono solo con un participio di cambio prima,
  // nella stessa frase: «manda la password a Luca» resta.
  const FUORI_LATINO = '[A-Za-zÀ-ÿ]';
  const intera = (xs) => `(?<!${FUORI_LATINO})(?:${xs.map((w) => w.replace(/ /g, '[ \\t]+')).join('|')})(?!${FUORI_LATINO})`;
  const AUSILIARE_CAMBIO = `(?:${intera(['è', "e'", 'e’', 'é', 'era', 'sarà', 'ha', 'aveva', 'is', 'was', 'has', 'have', 'had'])}[ \\t]+)?`
    + `(?:${intera(['stata', 'stato', 'been'])}[ \\t]+)?`;
  const PARTICIPIO_IT = intera(VERBI_CAMBIO.participi);
  const PARTICIPIO_EN = intera(VERBI_CAMBIO.participiInglesi);
  const PARTICIPIO_CAMBIO = intera([...VERBI_CAMBIO.participi, ...VERBI_CAMBIO.participiInglesi]);
  const PASSO = `(?:${PARTICIPIO_IT}[ \\t]+${intera(VERBI_CAMBIO.verso)}|${PARTICIPIO_EN}[ \\t]+${intera(VERBI_CAMBIO.versoInglese)})`;
  const CLITICO = `l['’][ \\t]*${intera(['ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno'])}[ \\t]+`;
  const PRESENTE = intera(['è', "e'", 'e’', 'é', 'is']);
  const ORA = intera(VERBI_CAMBIO.ora);
  const E_POI = intera(['e', 'ed', 'and']);
  // «il pin adesso diventa …», «ho cambiato il pin ed è diventato …».
  const CAMBIO_VALORE = `(?:[ \\t]+(?:${E_POI}[ \\t]+)?(?:${ORA}[ \\t]+)?(?:${CLITICO})?${AUSILIARE_CAMBIO}(?:${intera(VERBI_CAMBIO.diventa)}|${PASSO})`
    // Il participio si cerca all'indietro solo dopo la preposizione: un testo lungo non lo rilegge a ogni posizione.
    + `|[ \\t]+(?:${intera(VERBI_CAMBIO.verso)}(?<=${PARTICIPIO_IT}[^\\n.!?:;,]{1,80})|${intera(VERBI_CAMBIO.versoInglese)}(?<=${PARTICIPIO_EN}[^\\n.!?:;,]{1,80}))`
    + `|[ \\t]+(?:${ORA}[ \\t]+${PRESENTE}|${PRESENTE}[ \\t]+${ORA})`
    // Dopo «ho cambiato il pin» il valore nella frase che segue: solo le forme che lo presentano, non una frase qualunque.
    + `|(?:[ \\t]+(?:${CLITICO})?${AUSILIARE_CAMBIO}${PARTICIPIO_CAMBIO})?(?<=${PARTICIPIO_CAMBIO}[^\\n.!?:;,]{0,60})`
    + `(?:[ \\t]*[,.;:][ \\t]*|[ \\t]+)(?:${E_POI}[ \\t]+)?${intera(VERBI_CAMBIO.dopo)})`;
  const CAMBIO_IN_CODA = new RegExp(`(?:${CAMBIO_VALORE})[ \\t]*["'«“‘„(]*[ \\t]*$`, 'i');
  const DIVENTA_IN_CODA = new RegExp(`${intera(VERBI_CAMBIO.diventa)}[ \\t]*["'«“‘„(]*[ \\t]*$`, 'i');
  // Fra il nome e il verbo di cambio solo un complemento del nome («del cancello», «for my phone»): «il pin non funziona
  // e il prezzo diventa 4821» parla d'altro, il primo verbo chiude il nome come per «è» (#2678.3).
  const COMPLEMENTO_NOME = `(?:[ \\t]+(?:del|della|dello|dei|degli|delle|dell['’]|di|da|per|for|of|on)(?:[ \\t]*[^\\s\\d:=.,;!?|"'«“]{1,24}){1,3}?)`;
  const SOLO_COMPLEMENTO = new RegExp(`^${COMPLEMENTO_NOME}?$`, 'i');
  // Il verbo di cambio chiude `fra`, il testo fra il nome del dato e il valore; `prima` finisce col nome, e lì può stare
  // il participio. `solo`: in `fra` c'è solo il verbo; senza, anche un complemento del nome prima.
  function cambioFra(prima, fra, { solo = true } = {}) {
    const m = CAMBIO_IN_CODA.exec(prima + fra);
    if (!m || m.index < prima.length) return false;
    return solo ? m.index === prima.length : SOLO_COMPLEMENTO.test(fra.slice(0, m.index - prima.length));
  }
  // `fra` finisce con un verbo come «diventa»: presenta il valore del nome solo se cambioFra lo dice (#2714).
  const finisceColCambio = (fra) => DIVENTA_IN_CODA.test(fra);
  // Le etichette fuori dall'alfabeto latino, e i verbi attaccati del cinese, giapponese, coreano e thai, sono quelli dei
  // campi segreti (#1403.8); i verbi che sono una parola stanno in ANNUNCI qui sopra.
  if (!global.SN_CAMPI_SEGRETI && typeof require === 'function') require('./campiSegreti.js');
  const NON_LATINI = global.SN_CAMPI_SEGRETI.crea({}, () => false);
  // Cinese, giapponese e coreano scrivono anche i due punti larghi (：).
  const ATTACCO = new RegExp(`(?:^|[:：=]|(?:^|[\\s(])(?:${ANNUNCI.join('|')}|seguente|seguenti|following)`
    + `|(?:${NON_LATINI.ANNUNCI_ATTACCATI}))$`, 'i');
  const SOLO_ATTACCO = new RegExp(`^\\s*(?:[:：=]|${ANNUNCI.join('|')})?\\s*$`, 'i');
  const ALTRA_FRASE = /[.!?]\s+[A-ZÀ-Ý]/;
  const APRE_IN_CODA = new RegExp(`(?:\\s*(?:\\d{1,3}[.)]|[•·*"«»“”(${NON_LATINI.APRE_VALORE}-]|(?<![A-Za-zÀ-ÿ])'))*\\s*$`);
  // `prima`: il testo fino alla parola, per i verbi di cambio (CAMBIO_VALORE), che possono stare prima di lei.
  function annunciato(fra, valore = '', { stretto = false, prima = null } = {}) {
    if (prima !== null && cambioFra(prima, fra)) return true;
    if (ALTRA_FRASE.test(fra) || /\/|\bwww\./i.test(fra)) return false;
    // L'apostrofo dopo una lettera è di «e'», non una virgoletta che apre il valore.
    const g = fra.replace(APRE_IN_CODA, '');
    if (stretto && !g.trim()) return false;
    if (!ATTACCO.test(g)) return false;
    if (/=\s*$/.test(g) && !/^\s*=\s*$/.test(g)) return false;
    if (/[,;]\s/.test(g) && !SOLO_ATTACCO.test(g.split(/[,;]\s/).pop())) return false;
    if (!/[A-Za-z0-9À-ÿ]/.test(g.replace(ATTACCO, ''))) return true;
    if (stretto) return false;
    if (!/[:：]\s*$/.test(g)) return true;
    return !/^(?:\d{4}|[A-Za-z]{4,}\d{1,4})$/.test(String(valore));
  }
  // «482913 è il tuo codice OTP»: davanti alla parola il codice le si lega con un «è» o con niente.
  function legato(fra) {
    if (ALTRA_FRASE.test(fra)) return false;
    const g = fra.replace(/^[\s"'«»“”(:=-]*/, '');
    return !g || /^(?:è|e'|is|are|sono)\s/i.test(`${g} `);
  }
  // «otp-service», «django-otp», «2fa_enabled»: la parola dentro un nome tecnico non annuncia niente.
  function dentroUnNome(s, i, j) {
    return /[a-z0-9][-_.]$/.test(s.slice(Math.max(0, i - 2), i)) || /^[-_.][a-z]/.test(s.slice(j, j + 2));
  }

  // «Password: …», «la tua nuova password è …»: la parola da sola annuncia una password solo se la
  // segue subito l'attacco. Solo qui e non in `controlla`: un avviso che nomina la password e una
  // data non ha niente da fermare.
  // Le precisazioni sono un elenco chiuso, scelto dall'owner (#810): le forme nuove le vede il guardiano.
  const NON_LATINE = NON_LATINI.ETICHETTE_NON_LATINE;
  const FINE_VALORE = NON_LATINI.FINE_VALORE;
  const APRE_VALORE = NON_LATINI.APRE_VALORE;
  const MARCHIO_PASSWORD = new RegExp('(?:\\b(?:password|passcode|passphrase)(?:\\s+(?:di\\s+accesso|per\\s+il\\s+primo\\s+accesso'
    + `|iniziale|provvisori[ao]|for\\s+your\\s+account))?\\b|${NON_LATINE})`, 'i');
  // Gli altri nomi («Passwort», «contraseña», «mot de passe») li tiene urlExfil.js, che si carica dopo: si leggono alla
  // prima ricerca. Nei preload delle pagine urlExfil non c'è, e restano i nomi italiani e inglesi.
  let marchiPassword = null;
  function marchioPassword() {
    if (marchiPassword) return new RegExp(marchiPassword, 'gi');
    if (!global.SN_URL_EXFIL && typeof require === 'function' && typeof window === 'undefined') {
      try { require('./urlExfil.js'); } catch (_) { /* restano i nomi di qui */ }
    }
    const P = global.SN_URL_EXFIL && global.SN_URL_EXFIL.PRESENTA;
    if (!P || !P.altreLingue) return new RegExp(MARCHIO_PASSWORD.source, 'gi');
    marchiPassword = `(?:${MARCHIO_PASSWORD.source})|${P.altreLingue}`;
    return new RegExp(marchiPassword, 'gi');
  }
  const HASLO = /^has[łl]/i;
  const TO_POLACCO = /^\s*to\s*$/i;
  // Una parola sola, con una lettera e una cifra o un simbolo DENTRO: «Tr7#kq29Lm», «Kx82mPq!». Il segno ai
  // bordi («dimenticata?», «(obbligatoria)», «manager:») è punteggiatura; un indirizzo o una mail non sono password.
  const FORMA_PASSWORD = /^(?=.*[A-Za-z])(?=.*[^A-Za-z])(?=(?:[^A-Za-z0-9]*[A-Za-z0-9]){6})[^\s"'«»“”<>]{6,64}$/;
  // L'unico posto: anche il pavimento lo chiede qui, così i due cammini non danno esiti diversi sullo stesso testo.
  const indirizzoOEmail = (v) => /:\/\/|^www\./i.test(v) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v);
  function sembraPassword(v) {
    if (!FORMA_PASSWORD.test(v) || indirizzoOEmail(v)) return false;
    const nucleo = v.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    return /\d/.test(nucleo) || /[^A-Za-z0-9]/.test(nucleo);
  }
  function passwordAnnunciata(s, fine, stretto, out, polacco = false) {
    const finestra = s.slice(fine, fine + RAGGIO + 64);
    // L'attacco attaccato al valore è un attacco: in cinese dopo i due punti larghi (：) lo spazio non c'è, e il valore
    // finisce dove ricomincia la frase.
    const re = new RegExp(`[^\\s:：=${FINE_VALORE}][^\\s${FINE_VALORE}]*`, 'g');
    let t;
    while ((t = re.exec(finestra)) && t.index <= RAGGIO) {
      const v = t[0].replace(/[.,;)»”"']+$/, '');
      if (!sembraPassword(v)) continue;
      const fra = finestra.slice(0, t.index);
      const prima = s.slice(Math.max(0, fine - 120), fine);
      if (annunciato(fra, v, { stretto, prima }) || (polacco && TO_POLACCO.test(fra))) out.push({ valore: v, regola: 'password' });
      return;
    }
  }

  // Un titolo che nomina i codici al plurale («Codici di backup», «Recovery codes») vale per l'elenco che lo segue
  // entro un paragrafo, anche con una frase in mezzo: un elenco sono due o più codici, ognuno a inizio riga o di numero.
  const PLURALE = /\b(?:codici|codes|chiavi|keys)\b/i;
  const RAGGIO_ELENCO = 400;
  const A_INIZIO_RIGA = /(?:^|\n)[ \t]*(?:(?:\d{1,3}[.)]|[•·*-])[ \t]*)?$/;
  function elencoDopo(s, fine, tutti, k) {
    for (; k < tutti.length && tutti[k].i < fine + RAGGIO_ELENCO; k++) {
      if (!A_INIZIO_RIGA.test(s.slice(Math.max(0, tutti[k].i - 12), tutti[k].i))) continue;
      // Righe di blocchi col trattino arrivano già unite in un candidato solo.
      if (/\n/.test(tutti[k].v) && tutti[k].pezzi.length > 1) return k;
      if (k + 1 < tutti.length && FRA_CODICI.test(s.slice(tutti[k].j, tutti[k + 1].i))) return k;
    }
    return -1;
  }

  function codiciVicini(s, out) {
    const cerca = new RegExp(MARCHI_MONOUSO.source, 'gi');
    let tutti = null;
    const primo = (pos) => {
      let lo = 0;
      let hi = tutti.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tutti[mid].i < pos) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    let parola;
    while ((parola = cerca.exec(s)) && !out.saturo) {
      const inizio = parola.index;
      const fine = inizio + parola[0].length;
      if (dentroUnNome(s, inizio, fine)) continue;
      if (!tutti) tutti = candidatiDi(s);
      const regola = /pass/i.test(s.slice(inizio, fine)) ? 'password' : 'codice';
      const presi = [];
      let k = primo(fine);
      for (; k < tutti.length && tutti[k].i < fine + RAGGIO; k++) {
        if (annunciato(s.slice(fine, tutti[k].i), tutti[k].v, { prima: s.slice(Math.max(0, fine - 120), fine) })) {
          presi.push(tutti[k]);
          break;
        }
      }
      if (!presi.length && PLURALE.test(parola[0])) {
        k = elencoDopo(s, fine, tutti, primo(fine));
        if (k >= 0) presi.push(tutti[k]);
      }
      if (presi.length) {
        for (k += 1; k < tutti.length && presi.length < 40; k++) {
          if (!FRA_CODICI.test(s.slice(presi[presi.length - 1].j, tutti[k].i))) break;
          presi.push(tutti[k]);
        }
      } else {
        const c = tutti[primo(inizio) - 1];
        if (c && c.j <= inizio && c.i >= inizio - RAGGIO && legato(s.slice(c.j, inizio))) presi.push(c);
      }
      for (const c of presi) for (const v of c.pezzi) out.push({ valore: v, regola });
      if (regola === 'password') passwordAnnunciata(s, fine, false, out);
    }
    const pw = marchioPassword();
    while ((parola = pw.exec(s)) && !out.saturo) {
      const fine = parola.index + parola[0].length;
      if (!dentroUnNome(s, parola.index, fine)) passwordAnnunciata(s, fine, true, out, HASLO.test(parola[0]));
    }
  }

  // Le credenziali riconosciute dal posto, di qualunque forma: il token dell'intestazione di autorizzazione, la password
  // dentro un indirizzo (utente:password@) e quella data con l'utente a un programma di rete (`curl -u`, `--user`).
  const INTESTAZIONE = new RegExp('\\bAuthorization[ \\t]{0,8}:[ \\t]{0,8}(?:Bearer|Basic|Token|Digest)[ \\t]{1,8}'
    + `([A-Za-z0-9._~+/=-]{8,${MAX_TOKEN}})`, 'gi');
  const NELL_INDIRIZZO = /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s/:@"'`]{1,256}:([^\s/@"'`]{4,256})@/gi;
  const OPZIONE_UTENTE = /(?:^|\s)(?:-u|--user|--proxy-user)(?:=|\s{1,8})["']?[^\s:"'/@]{1,256}:([^\s"']{4,256})/g;
  // Chi registra quello che ha letto scarta i segnaposto della documentazione («Bearer YOUR_TOKEN», «user:${PASSWORD}@»),
  // che resterebbero un mese a fermare ogni uscita con quella parola; chi controlla un'uscita prende ogni valore al suo posto.
  const tokenCasuale = (v) => /[A-Za-z]/.test(v) && (/\d/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
  const FORMA_LETTA = { token: tokenCasuale, password: sembraPassword };
  function passwordInUscita(v) {
    const s = String(v || '');
    // Le lettere di ogni alfabeto sono lettere: «неверный» (sbagliata) dopo l'etichetta è una parola, non una password.
    return s.length >= 4 && (/[0-9]/.test(s) || /[^\p{L}\p{N}]/u.test(s) || (/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s.slice(1))));
  }
  const FORMA_USCENTE = { token: () => true, password: passwordInUscita };
  function credenzialiAlPosto(s, out, forma) {
    for (const m of s.matchAll(INTESTAZIONE)) if (forma.token(m[1])) out.push({ valore: m[1], regola: 'chiave' });
    for (const re of [NELL_INDIRIZZO, OPZIONE_UTENTE]) {
      for (const m of s.matchAll(re)) if (forma.password(m[1])) out.push({ valore: m[1], regola: 'password' });
    }
  }

  // `[{ valore, regola }]` con regola 'codice' | 'password' | 'chiave' | 'iban' | 'carta'. `saturo` sull'elenco: il
  // testo ne aveva più del tetto, o una chiave più lunga di MAX_TOKEN, e chi controlla un'uscita lì guarda la presenza
  // dei suoi pezzi (urlExfil.js).
  function segretiNelTesto(testoLetto) {
    return raccogli(testo(testoLetto), raccolta(), FORMA_LETTA);
  }

  // Quello che un'azione porterebbe fuori (autonomia.js): le stesse forme di segretiNelTesto, anche percent-codificate, più
  // le parole che lo annunciano lette larghe («il pin è 4821», «password=Ciao2024»). Qui un falso allarme chiede
  // «conferma» o lascia fare a mano; nel registro dei letti fermerebbe per un mese ogni uscita con quel valore.
  // Il PIN anche con un complemento prima del verbo («il pin del telefono è 4821», «the pin for my phone is 4821»): il
  // primo verbo chiude, così «se il pin è giusto la pagina è 2048» non conta (#2678.3). Il verbo è ogni parola di ANNUNCI
  // anche nelle forme larghe, come per il pavimento verso i modelli («il pin del telefono é 4821», «è ancora», #1403.83);
  // l'infinito e «ecco» non chiudono: «the pin to be used is 4821», «the pin here is 4821». Il verbo regge anche i due
  // punti o l'uguale dopo di sé («il pin è: 4821», «è = 4821», #1403.83 giro 1).
  // Le lunghezze di un PIN (o codice) e di un CVV, da qui sole: le leggono le regole che trovano il primo valore, qui e
  // nel pavimento, e quella dei numeri accanto in elenco; una misura allargata in un posto solo lascerebbe uscire il secondo.
  const MISURE_CIFRE = Object.freeze({ codice: Object.freeze([4, 8]), cvv: Object.freeze([3, 4]) });
  const cifre = (regola) => `\\d{${MISURE_CIFRE[regola][0]},${MISURE_CIFRE[regola][1]}}`;
  // Dopo il verbo anche l'articolo, come per il CVV: «il pin è il 4829».
  const ARTICOLO = '(?:(?:il|lo|la|el|le|die|der|das|the)\\s{1,8})?';
  const PIN_CHIUDE = `(?!(?:be|essere|here|ecco)(?![\\p{L}\\p{N}]))${ANNUNCIO}`;
  // Il verbo di cambio (CAMBIO_VALORE) si prova per primo, e solo dopo un complemento del nome: dopo «è» di «è diventata» il
  // valore non c'è ancora, e «il pin non funziona e il prezzo diventa 4821» parla d'altro.
  const PIN_CON_COMPLEMENTO = new RegExp(`\\bpin\\b(?:${COMPLEMENTO_NOME}${CAMBIO_VALORE}`
    + `|(?:\\s{1,8}(?!${PIN_CHIUDE})(?!(?:${intera(VERBI_CAMBIO.diventa)})(?=\\s))[^\\s\\d:=.,;!?|"'«“]{1,24}){1,5}?`
    + `\\s{0,8}(?:[:=]|(?<![\\p{L}\\p{N}])(?:${ANNUNCIO_LARGO})(?=[\\s:=])(?:\\s{0,8}[:=])?))`
    + `\\s{0,8}${ARTICOLO}["'«“]?(${cifre('codice')})(?!\\d)`, 'giu');
  const PAROLA_PASSWORD = new RegExp(`(?:password|passwd|pwd|passphrase|parola\\s{1,8}d['’]ordine|chiave\\s{1,8}segreta|secret|${NON_LATINE})`
    + `(?:${CAMBIO_VALORE}|\\s{0,8}(?:[:：=]|${ANNUNCIO}|${NON_LATINI.ANNUNCI_ATTACCATI}))`
    + `\\s{0,8}(?:["'«“]|[${APRE_VALORE}]\\s{0,8})?([^\\s"'»”,;&${FINE_VALORE}]{4,256})`, 'giu');
  const PAROLA_CODICE = new RegExp(`(?:\\botp\\b|\\b2fa\\b|\\bone[-\\s]?time\\b|\\bpin\\b|\\bcodic[ei]\\s{1,8}(?:di\\s{1,8})?(?:verifica|accesso|sicurezza|conferma|recupero|backup|autenticazione|usa\\s+e\\s+getta|monouso|temporane[oi]|sms)\\b|\\b(?:recovery|backup|verification|security)\\s{1,8}codes?\\b)(?:${CAMBIO_VALORE}\\s{0,8}|[\\s:=]{0,8}(?:${ANNUNCIO}(?:\\s{1,8}|\\s{0,8}[:=]\\s{0,8})${ARTICOLO})?)["'«“]?(\\d[A-Za-z0-9]{3,256}|[A-Za-z0-9]{4,64}(?:[-\\s][A-Za-z0-9]{4,64}){1,9})`, 'giu');
  // Il valore che segue il nome del dato (PIN, codice che apre, password) nella sua frase, o nella risposta dopo la sua
  // domanda, presentato da una parola degli elenchi comuni (ANNUNCI, CAMBI, PARTICIPI, PASSATI, VERSO dopo un cambio):
  // una regola sola per il pavimento e le uscite al posto dei casi (#2714 giro 7). Un altro soggetto («e il prezzo
  // diventa 4821») chiude; una parola che dice com'è il dato («è giusto») toglie l'annuncio. Prove: tests/unit/cambioDelValore.test.mjs.
  const NOME_DEL_VALORE = new RegExp('(?<![\\p{L}\\p{N}])(?:(pin)|(codic[ei]\\s+(?:del|della|dello|dell[\'’]\\s*)\\s*(?:cancello|portone|allarme|cassaforte|garage|box|lucchetto|porta|antifurto))'
    + '|(password|passwd|pwd|passphrase|parola\\s+d[\'’]ordine))(?![\\p{L}\\p{N}])', 'giu');
  const UN_NOME_DEL_VALORE = new RegExp(NOME_DEL_VALORE.source, 'iu');
  const intere = (re) => new RegExp(`^(?:${re})$`, 'iu');
  const PRESENTA_VALORE = intere(`${ANNUNCI.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|${CAMBI}|${PARTICIPI}|${PASSATI}`);
  const UN_CAMBIO = intere(`${CAMBI}|${PARTICIPI}|${PASSATI}`);
  const CAMBIO_INGLESE = /^(?:changed|set|updated|reset|replaced|became|remained|stayed)$/i;
  const PONTE_DEL_CAMBIO = intere(VERSO);
  // Parole che non spostano il valore e non lo descrivono: ausiliari, avverbi, negazioni, il pronome, «il nuovo».
  const NEUTRA = intere(`${AVVERBIO}|${AVVERBI}|${MODALI}|non|più|piu|not|no|sì|si|yes|ok|okay|it|its|it's|that|lo|la|l|ho|hai|abbiamo|avete|hanno`
    + '|ce|c|s|ha|has|have|had|quello|quella|nuovo|nuova|new|one|vecchio|vecchia|old|prima|poi|before|after|il|the|mio|mia|my|e|ed|and|ma|but');
  const DETERMINANTE = /^(?:il|lo|la|l|i|gli|le|un|uno|una|the|a|an|my|your|his|her|our|their|mio|mia|tuo|tua|suo|sua)$/i;
  const PREPOSIZIONE = /^(?:di|del|della|dello|dei|degli|delle|dell|per|for|of|on|su|sul|sulla|nel|nella|in|da|dal|dalla|con|with|a|al|alla|to)$/i;
  const UNITA = /^(?:euro|eur|€|\$|usd|dollari|dollars?|km|kg|pagine|pagina|pages?|anni|giorni|ore|minuti|mesi|metri|persone|volte|cifre|caratteri|%)$/i;
  const ANNO_VALORE = /^(?:19|20)\d\d$/;
  const LUOGO_DEL_CAMBIO = /^(?:in|su|on|a)$/i;
  function valoriDopoIlNome(testoIntero, { uscita = false } = {}) {
    const s = testo(testoIntero);
    const out = [];
    for (const n of s.matchAll(NOME_DEL_VALORE)) {
      const password = !!n[3];
      const fine = n.index + n[0].length;
      const clausola = s.slice(Math.max(0, n.index - 80), n.index).split(/[.!?;,](?:\s|$)|\n/).pop();
      let cambio = clausola.split(/[\s'’]+/).some((w) => UN_CAMBIO.test(w));
      let inglese = clausola.split(/[\s'’]+/).some((w) => CAMBIO_INGLESE.test(w));
      let presentato = false;
      let passati = 0;
      let parole = 0;
      let prec = '';
      const toks = [...s.slice(fine, fine + 200).matchAll(/[^\s'’]+['’]?/g)];
      for (let k = 0; k < toks.length && parole < 16 && out.length < 40; k++) {
        const grezzo = toks[k][0];
        const nucleo = grezzo.replace(/^["'«“‘„(]+/, '').replace(/[.,;:!?)»”"'’]+$/, '');
        const coda = /[.,;:!?)»”"'’]*$/.exec(grezzo)[0];
        const parola = nucleo.toLowerCase();
        parole++;
        if (!nucleo) { /* solo punteggiatura */ } else if (/^\d+$/.test(nucleo)) {
          const misura = MISURE_CIFRE.codice;
          const dopo = toks[k + 1] ? toks[k + 1][0].replace(/[.,;:!?)»”"']+$/, '') : '';
          if (password || !presentato || nucleo.length < misura[0] || nucleo.length > misura[1] || UNITA.test(dopo) || /[%€$]/.test(coda)) break;
          if (ANNO_VALORE.test(nucleo) && (/^(?:nel|dal|since)$/i.test(prec) || (inglese && /^in$/i.test(prec)))) break;
          out.push({ valore: nucleo, regola: 'codice' });
          presentato = true;
        } else if (password && presentato && (uscita ? passwordInUscita(nucleo) : sembraPassword(nucleo))
          && !(LUOGO_DEL_CAMBIO.test(prec) && /^\p{L}+$/u.test(nucleo)) && !PRESENTA_VALORE.test(parola) && !NEUTRA.test(parola)) {
          out.push({ valore: nucleo, regola: 'password' });
        } else if (PRESENTA_VALORE.test(parola)) {
          presentato = true;
          if (UN_CAMBIO.test(parola)) cambio = true;
          if (CAMBIO_INGLESE.test(parola)) inglese = true;
        } else if (cambio && PONTE_DEL_CAMBIO.test(parola)) {
          presentato = true;
        } else if (DETERMINANTE.test(parola) && !PREPOSIZIONE.test(prec) && toks[k + 1] && /^\p{L}{2,}/u.test(toks[k + 1][0])
          && !NEUTRA.test(toks[k + 1][0].replace(/[.,;:!?)»”"']+$/, '')) && !UN_NOME_DEL_VALORE.test(toks[k + 1][0])) {
          break;
        } else if (!NEUTRA.test(parola) && !PREPOSIZIONE.test(parola)) {
          // «è giusto», «è scritta sul foglio»: dopo l'annuncio una parola che lo descrive, e il valore non c'è.
          presentato = false;
        }
        prec = parola;
        if (/[.!?;]$/.test(coda)) {
          // Si passa una frase sola: la risposta dopo la domanda, o quella dopo «ho cambiato il pin».
          if (passati || !(/\?$/.test(coda) || cambio)) break;
          passati++;
        }
      }
    }
    return out;
  }

  function segretiInUscita(testoUscente) {
    let s = testo(testoUscente);
    try { s = `${s}\n${decodeURIComponent(s.replace(/\+/g, ' '))}`; } catch (_) { /* un % che non codifica niente */ }
    const senzaAvverbi = avverbiComeSpazi(s, { stessaLunghezza: false });
    if (senzaAvverbi !== s) s = `${s}\n${senzaAvverbi}`;
    const out = raccolta();
    raccogli(s, out, FORMA_USCENTE);
    // «ho cambiato la password in PayPal» dice dove: dopo «in», «su» o «a» un nome di sole lettere non è il valore.
    for (const m of s.matchAll(PAROLA_PASSWORD)) {
      if (passwordInUscita(m[1]) && !(/^\p{L}+$/u.test(m[1]) && /(?:^|\s)(?:in|su|on|a)\s*$/i.test(m[0].slice(0, -m[1].length)))) {
        out.push({ valore: m[1], regola: 'password' });
      }
    }
    for (const v of valoriDopoIlNome(s, { uscita: true })) out.push(v);
    for (const m of s.matchAll(PAROLA_CODICE)) if (/\d/.test(m[1])) out.push({ valore: m[1], regola: 'codice' });
    for (const m of s.matchAll(PIN_CON_COMPLEMENTO)) out.push({ valore: m[1], regola: 'codice' });
    for (const x of codiciDelPavimento(s)) out.push(x);
    out.push(...codiciInElenco(s, out.valori));
    return Object.defineProperty(out.valori, 'saturo', { value: out.saturo });
  }
  // Il codice di ciò che si apre (il mio telefono, il cancello), la password detta col suo complemento («la password del
  // mio pc è …») e il CVV non escono da un'azione (#1403.89): le forme sono del pavimento, e qui si chiedono a lui. Gli
  // altri suoi codici no: «se il pin è giusto la pagina è 2048» lì si toglie, qui fermerebbe l'azione.
  // La password solo dopo il verbo o il separatore: in «The password war2023 is not valid» il pavimento toglie, qui no.
  // Il CVV vale la carta: scritto dall'utente esce come il numero accanto.
  const DAL_PAVIMENTO = {
    codice: (x) => (x.apre ? 'codice' : ''),
    password: (x, s) => (passwordInUscita(x.valore)
      && new RegExp(`(?:[:=：]|${ANNUNCIO})\\s*["'«“„]?${escRe(String(x.valore))}`, 'iu').test(s) ? 'password' : ''),
    cvv: () => 'carta',
  };
  function codiciDelPavimento(s) {
    if (!global.SN_PAVIMENTO && typeof require === 'function') { try { require('./pavimento.js'); } catch (_) { /* resta senza */ } }
    const P = global.SN_PAVIMENTO;
    if (!P || typeof P.trova !== 'function') return [];
    const out = [];
    // Il valore di un parametro si legge come una riga sua: «?t=La password del mio pc è …» è la frase, non un campo.
    const righe = s.replace(/[?&#][\w.%[\]-]{0,64}=/g, '\n');
    for (const x of P.trova(righe)) {
      const regola = DAL_PAVIMENTO[x.regola] ? DAL_PAVIMENTO[x.regola](x, righe) : '';
      if (regola) out.push({ valore: String(x.valore), regola });
    }
    return out;
  }

  // Un PIN, un codice o un CVV trovato vale per i numeri della stessa forma che lo seguono nella stessa frase: «i pin
  // sono 4829 e 1234», «il cvv è 123, 456», «4829 e quello della SIM è 1234», «4829; 1234», a capo «e 1234» (#1403.79).
  // Le parole in mezzo hanno un tetto e non passano un punto; un a capo vale solo con la congiunzione o il trattino d'elenco.
  const CONGIUNZIONE = '(?:e|ed|o|oppure|ma|mentre|and|or|but|while|und|oder|aber|et|ou|mais|y|pero|i|oraz|lub|albo|en|of)';
  const SEPARA = `(?:[ \\t]*[,;/&][ \\t]*|[ \\t]+[-–—][ \\t]+|[ \\t]*\\n[ \\t]*(?:[-–—•*][ \\t]+|(?=${CONGIUNZIONE}[ \\t]))`
    + `|[ \\t]+${CONGIUNZIONE}[ \\t]*\\n[ \\t]*|[ \\t]+(?=${CONGIUNZIONE}[ \\t]))`;
  const PAROLE_IN_MEZZO = "(?:[\\p{L}'’]{1,24}(?:[ \\t]*[:=][ \\t]*|[ \\t]+)){0,6}";
  const CIFRE_ACCANTO = `\\d{${Math.min(...Object.values(MISURE_CIFRE).map((x) => x[0]))},${Math.max(...Object.values(MISURE_CIFRE).map((x) => x[1]))}}`;
  const ACCANTO_IN_ELENCO = new RegExp(`["'»”)*_]{0,4}${SEPARA}${PAROLE_IN_MEZZO}["'«“(*_]{0,4}(${CIFRE_ACCANTO})(?![\\d\\p{L}]|[.,/:-]\\d)`, 'uy');
  function codiciInElenco(s, valori) {
    const nuovi = [];
    const visti = new Set((valori || []).map((x) => `${x.regola}:${x.valore}`));
    const letti = new Set();
    for (const x of valori || []) {
      const misura = MISURE_CIFRE[x.regola];
      const v = String(x.valore);
      if (!misura || !/^\d+$/.test(v) || letti.has(`${x.regola}:${v}`)) continue;
      letti.add(`${x.regola}:${v}`);
      for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
        if (/[\p{L}\p{N}]/u.test(s[i - 1] || '') || /[\p{L}\p{N}]/u.test(s[i + v.length] || '')) continue;
        ACCANTO_IN_ELENCO.lastIndex = i + v.length;
        let m;
        for (let n = 0; n < 40 && (m = ACCANTO_IN_ELENCO.exec(s)); n++) {
          if (m[1].length < misura[0] || m[1].length > misura[1]) break;
          const k = `${x.regola}:${m[1]}`;
          if (!visti.has(k)) { visti.add(k); nuovi.push({ valore: m[1], regola: x.regola }); }
        }
      }
    }
    return nuovi;
  }

  function raccogli(s, out, forma) {
    const fine = () => Object.defineProperty(out.valori, 'saturo', { value: out.saturo, configurable: true });
    if (!s.trim()) return fine();
    let oltre = false;
    for (const re of FORME_CHIAVE) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(s)) && !out.saturo) {
        if (m[1]) oltre = true;
        out.push({ valore: m[1] ? m[0].slice(0, -m[1].length) : m[0], regola: 'chiave' });
      }
    }
    credenzialiAlPosto(s, out, forma);
    codiciVicini(s, out);
    for (const m of s.match(IBAN_RE) || []) {
      if (ibanValido(m)) out.push({ valore: m.replace(/\s/g, ''), regola: 'iban' });
    }
    for (const m of s.match(CARTA_RE) || []) {
      if (cartaValida(m)) out.push({ valore: m.replace(/[\s-]/g, ''), regola: 'carta' });
    }
    if (oltre) out.saturo = true;
    return fine();
  }

  // ── I segreti custoditi non entrano in un prompt (#810) ──────────────────
  // Il cancello dei modelli passa ogni messaggio di qui: un comando che stampa la chiave di
  // Opzioni non la mette davanti al modello, che così non la può far uscire.
  const OSCURATO = '[segreto custodito da Filo]';

  // Un segreto si riconosce anche travestito (#810): maiuscole, al contrario, spezzato da separatori o a capo,
  // in base64, esadecimale o percentuale. Chi lo stampa così da un comando non deve poterlo passare a un modello.
  const alnumMinuscolo = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rovescio = (s) => [...s].reverse().join('');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const STAMPABILE = /^[\x09\x0a\x0d\x20-\x7e]*$/;

  // Un pezzo della parte variabile lungo così ricostruisce la chiave, anche senza il prefisso o con qualche carattere in
  // meno (#1507). È la stessa misura con cui urlExfil.js confronta un'uscita con quello che l'agente ha letto.
  const FINESTRA = 20;

  // `norm` è il segreto in sola forma alfanumerica minuscola; `nucleo` la stessa senza i pezzi fissi del suo tipo, se è
  // abbastanza lungo da contare; le finestre cominciano fra `da` e `a`, tutte dentro la parte variabile: una che prende
  // anche il prefisso fisso combacia con un'altra chiave dello stesso tipo appena ne condivide un carattere.
  function partiSegreto(valore) {
    const v = testo(valore).trim();
    const norm = alnumMinuscolo(v);
    const pre = Math.min(norm.length, alnumMinuscolo((v.match(PREFISSO_FISSO) || [''])[0]).length);
    const fine = Math.max(pre, norm.length - alnumMinuscolo((v.match(CODA_FISSA) || [''])[0]).length);
    const nucleo = norm.slice(pre, fine);
    const conta = nucleo.length >= SEGRETO_MIN && nucleo !== norm;
    return { norm, nucleo: conta ? nucleo : '', nuclei: conta ? [nucleo, rovescio(nucleo)] : [], da: pre, a: fine - FINESTRA + 1 };
  }

  function finestreDi(parti) {
    const out = new Set();
    for (let i = parti.da; i < parti.a; i++) out.add(parti.norm.slice(i, i + FINESTRA));
    return out;
  }

  // Le finestre di un segreto in entrambi i versi: il valore intero si riconosce anche al contrario, e un suo pezzo
  // deve ereditare lo stesso travestimento (#1507).
  function finestreSegreto(parti) {
    const out = finestreDi(parti);
    for (const f of [...out]) out.add(rovescio(f));
    return out;
  }

  // `piatto` in sola forma alfanumerica minuscola.
  function haFinestra(piatto, finestre) {
    if (!finestre || !finestre.size) return false;
    for (let i = 0; i + FINESTRA <= piatto.length; i++) if (finestre.has(piatto.slice(i, i + FINESTRA))) return true;
    return false;
  }

  // Toglie i tratti che le finestre coprono. Posizioni e forma piatta nascono insieme: un carattere che cambia lunghezza
  // quando diventa minuscolo non sposta il taglio.
  function togliFinestre(t, finestre, segno) {
    const pos = [];
    let piatto = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (/[A-Za-z0-9]/.test(ch)) { pos.push(i); piatto += ch.toLowerCase(); }
    }
    const tratti = [];
    for (let i = 0; i + FINESTRA <= piatto.length; i++) {
      if (!finestre.has(piatto.slice(i, i + FINESTRA))) continue;
      const u = tratti[tratti.length - 1];
      if (u && i <= u[1]) u[1] = i + FINESTRA; else tratti.push([i, i + FINESTRA]);
    }
    let out = t;
    for (let k = tratti.length - 1; k >= 0; k--) {
      const a = pos[tratti[k][0]];
      const b = pos[tratti[k][1] - 1] + 1;
      out = out.slice(0, a) + segno(out.slice(a, b)) + out.slice(b);
    }
    return out;
  }

  function decodifiche(tok) {
    const out = [];
    let cur = tok;
    for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(cur); i++) {
      const dec = cur.replace(/(?:%[0-9A-Fa-f]{2})+/g, (p) => { try { return decodeURIComponent(p); } catch (_) { return p.replace(/%([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); } });
      if (dec === cur) break;
      out.push(dec);
      cur = dec;
    }
    for (const run of tok.match(/[A-Za-z0-9+/_-]{16,}/g) || []) {
      const b = run.replace(/-/g, '+').replace(/_/g, '/');
      // Un pezzo di base64 tagliato in un punto qualsiasi si riallinea togliendo da uno a tre caratteri.
      for (let k = 0; k < 4; k++) {
        const pezzo = b.slice(k, k + Math.floor((b.length - k) / 4) * 4);
        if (pezzo.length < 16) break;
        try {
          const bin = typeof atob === 'function' ? atob(pezzo) : Buffer.from(pezzo, 'base64').toString('binary');
          if (STAMPABILE.test(bin)) out.push(bin);
        } catch (_) { /* non era base64 */ }
      }
    }
    for (const run of tok.match(/[0-9A-Fa-f]{24,}/g) || []) {
      for (let k = 0; k < 2; k++) {
        let h = '';
        for (let i = k; i + 1 < run.length; i += 2) h += String.fromCharCode(parseInt(run.slice(i, i + 2), 16));
        if (STAMPABILE.test(h)) out.push(h);
      }
    }
    return out;
  }

  // `segno(tolto)` dà quello che prende il posto del tratto tolto: OSCURATO verso un modello, un segno lungo quanto il
  // tratto per chi deve sapere dove stava (trattiSegreti).
  const SEGNO_OSCURATO = () => OSCURATO;
  function oscuraTesto(s, chiavi, finestre, segno = SEGNO_OSCURATO) {
    // Una foto mandata al modello è pixel, non testo: decodificarla costerebbe e non troverebbe niente.
    if (/^data:image\//i.test(s.slice(0, 16))) return s;
    let t = s;
    for (const c of chiavi) {
      t = t.split(c.v).join(segno(c.v));
      t = t.replace(c.re, (m) => segno(m));
    }
    // Base64 a righe (il comando base64 va a capo ogni 76 caratteri) si legge come un pezzo solo.
    t = t.replace(/[A-Za-z0-9+/=_-]{16,}(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9+/=_-]{4,})+|\S{8,}/g, (tok) => {
      if (/^data:image\//i.test(tok)) return tok;
      // Quanto del segreto porta: tutto (un segreto intero) o quante sue finestre.
      const quanto = (x) => {
        const forme = decodifiche(x.replace(/\s+/g, '')).map(alnumMinuscolo);
        if (chiavi.some((c) => forme.some((f) => f.includes(c.norm) || f.includes(c.rov) || c.nuclei.some((n) => f.includes(n))))) return Infinity;
        const viste = new Set();
        for (const f of forme) for (let i = 0; i + FINESTRA <= f.length; i++) if (finestre.has(f.slice(i, i + FINESTRA))) viste.add(f.slice(i, i + FINESTRA));
        return viste.size;
      };
      const tutto = quanto(tok);
      if (!tutto) return tok;
      // Le righe in coda che non portano niente del segreto restano: sono il testo che segue.
      const righe = tok.split('\n');
      const coda = [];
      while (righe.length > 1 && quanto(righe.slice(0, -1).join('\n')) >= tutto) coda.unshift(righe.pop());
      return [segno(righe.join('\n')), ...coda].join('\n');
    });
    // Separatori qualunque fra un carattere e l'altro: si confronta la sola forma alfanumerica e si toglie il tratto originale.
    let piatto = alnumMinuscolo(t);
    for (const c of chiavi) {
      for (const cerca of [c.norm, c.rov, ...c.nuclei]) {
        let guardia = 0;
        while (piatto.includes(cerca) && guardia++ < 1000) {
          const pos = [];
          for (let i = 0; i < t.length; i++) if (/[A-Za-z0-9]/.test(t[i])) pos.push(i);
          const at = piatto.indexOf(cerca);
          const a = pos[at];
          const b = pos[at + cerca.length - 1] + 1;
          t = t.slice(0, a) + segno(t.slice(a, b)) + t.slice(b);
          piatto = alnumMinuscolo(t);
        }
      }
    }
    return haFinestra(piatto, finestre) ? togliFinestre(t, finestre, segno) : t;
  }

  function chiaviDi(segreti) {
    const chiavi = [];
    const finestre = new Set();
    for (const x of Array.isArray(segreti) ? segreti : []) {
      const { v, min } = segretoDi(x);
      const p = partiSegreto(v);
      if (v.length < min || p.norm.length < min) continue;
      chiavi.push({ v, norm: p.norm, rov: rovescio(p.norm), nuclei: p.nuclei, re: new RegExp(`${escRe(v)}|${escRe(rovescio(v))}`, 'gi') });
      for (const f of finestreSegreto(p)) finestre.add(f);
    }
    return { chiavi, finestre };
  }

  // Dove un testo porta un segreto custodito, riconosciuto come lo riconosce oscuraSegreti (anche travestito o senza
  // prefisso): `[[inizio, fine]]` nel testo originale. Chi avvisa l'utente deve vedere quello che il modello non vede.
  const SEGNO_TRATTO = '\u0000';
  function trattiSegreti(testoLetto, segreti) {
    const s = testo(testoLetto).split(SEGNO_TRATTO).join(' ');
    const { chiavi, finestre } = chiaviDi(segreti);
    if (!chiavi.length || !s) return [];
    const segnato = oscuraTesto(s, chiavi, finestre, (tolto) => SEGNO_TRATTO.repeat(tolto.length));
    const out = [];
    for (let i = segnato.indexOf(SEGNO_TRATTO); i >= 0; i = segnato.indexOf(SEGNO_TRATTO, i)) {
      let j = i;
      while (segnato[j] === SEGNO_TRATTO) j++;
      out.push([i, j]);
      i = j;
    }
    return out;
  }

  function oscuraSegreti(valore, segreti) {
    const { chiavi, finestre } = chiaviDi(segreti);
    if (!chiavi.length || valore == null) return valore;
    // Lo stesso oggetto quando non c'è niente da togliere: chi lo riceve non paga una copia.
    const giro = (v, n) => {
      if (typeof v === 'string') return oscuraTesto(v, chiavi, finestre);
      if (n > 12 || !v || typeof v !== 'object') return v;
      let cambiato = false;
      const o = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) {
        const x = giro(v[k], n + 1);
        if (x !== v[k]) cambiato = true;
        o[k] = x;
      }
      return cambiato ? o : v;
    };
    return giro(valore, 0);
  }

  global.SN_GUARDIANO_STATICO = {
    controlla, ibanValido, luhn, cartaValida, hostNominato, hostDi, stessoSito, linkNelTesto,
    segretiNelTesto, segretiInUscita, codiciInElenco, MISURE_CIFRE, cifre, oscuraSegreti, trattiSegreti, partiSegreto, finestreDi, finestreSegreto, haFinestra, SEGRETO_MIN, PASSWORD_MIN, segretoDi, segnaPassword, OSCURATO, FINESTRA,
    sembraPassword, indirizzoOEmail, ANNUNCI, ANNUNCIO_LARGO, AVVERBI, MODALI, COMPLEMENTO, CAMBI, PARTICIPI, PASSATI, PROPRIETA_PASSWORD,
    AVVERBIO, avverbiComeSpazi, VERBI_CAMBIO, CAMBIO: CAMBIO_VALORE, cambioFra, finisceColCambio, valoriDopoIlNome,
    ELENCO: { SEPARA, CONGIUNZIONE },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
