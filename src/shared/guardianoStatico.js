// I controlli che fermano un avviso (#536) o un'uscita (#810) SENZA chiedere a nessun modello.
// Devono funzionare a rete staccata e sbagliare di rado: solo forme che non hanno nessuna ragione
// di comparire in un testo onesto. Prove: tests/unit/guardianoStatico.test.mjs, usciteSegreti.test.mjs.

(function (global) {
  'use strict';

  // Un segreto più corto di così è una parola, non una chiave: confrontarlo
  // fermerebbe avvisi innocui che la contengono per caso.
  const SEGRETO_MIN = 12;

  // Qui NON si indovina se un codice è una credenziale: si riconoscono solo le
  // forme che in una frase onesta non compaiono. Un codice «di verifica», «di
  // accesso», «di conferma» descrive quasi sempre un portone, una
  // prenotazione, un wifi o una SIM, e sette giri di correzioni hanno mostrato
  // che l'elenco delle cose innocue non finisce mai: quelle frasi le legge il
  // guardiano, che vede la frase intera. Qui restano i marchi del codice
  // MONOUSO, che nessuno usa per il cancello di casa (#536): il nome del codice col suo senso, anche oltre un
  // complemento («codice di sicurezza monouso») o una parola («two-factor authentication code»).
  const NOME_CODICE = '(?:codic\\w*|chiav[ei]|passwords?|passphrases?|passcodes?|codes?|pins?)';
  const SENSO_MONOUSO = '(?:recupero|ripristino|backup|temporane\\w+|temporary|monouso|usa\\s+e\\s+getta|recovery'
    + '|one[\\s-]?time|single[\\s-]?use|(?:a|in)\\s+due\\s+(?:fattori|passaggi)|two[\\s-]?(?:factor|step))';
  const PAROLA = "[\\wÀ-ÿ'’-]+";
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

  // Le chiavi si riconoscono dal prefisso che il loro emittente ci mette
  // apposta: cercare «stringa lunga e casuale» prenderebbe mezzo web.
  const FORME_CHIAVE = [
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    /\bAIza[A-Za-z0-9_-]{20,}/,
    /\bAKIA[A-Z0-9]{12,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

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
      const v = testo(seg).trim();
      if (v.length >= SEGRETO_MIN && s.includes(v)) {
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
  const ATTACCO = /(?:^|[:=]|(?:^|[\s(])(?:è|e'|is|are|was|sono|ecco|here|vale|risulta|seguente|seguenti|following))$/i;
  const SOLO_ATTACCO = /^\s*(?:[:=]|è|e'|is|are|was|sono|ecco|here|vale|risulta)?\s*$/i;
  const ALTRA_FRASE = /[.!?]\s+[A-ZÀ-Ý]/;
  function annunciato(fra, valore = '', { stretto = false } = {}) {
    if (ALTRA_FRASE.test(fra) || /\/|\bwww\./i.test(fra)) return false;
    const g = fra.replace(/(?:\s*(?:\d{1,3}[.)]|[•·*"'«»“”(-]))*\s*$/, '');
    if (stretto && !g.trim()) return false;
    if (!ATTACCO.test(g)) return false;
    if (/=\s*$/.test(g) && !/^\s*=\s*$/.test(g)) return false;
    if (/[,;]\s/.test(g) && !SOLO_ATTACCO.test(g.split(/[,;]\s/).pop())) return false;
    if (!/[A-Za-z0-9À-ÿ]/.test(g.replace(ATTACCO, ''))) return true;
    if (stretto) return false;
    if (!/:\s*$/.test(g)) return true;
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
  const MARCHIO_PASSWORD = new RegExp('\\b(?:password|passcode|passphrase)(?:\\s+(?:di\\s+accesso|per\\s+il\\s+primo\\s+accesso'
    + '|iniziale|provvisori[ao]|for\\s+your\\s+account))?\\b', 'i');
  // Una parola sola, con una lettera e una cifra o un simbolo DENTRO: «Tr7#kq29Lm», «Kx82mPq!». Il segno ai
  // bordi («dimenticata?», «(obbligatoria)», «manager:») è punteggiatura; un indirizzo o una mail non sono password.
  const FORMA_PASSWORD = /^(?=.*[A-Za-z])(?=.*[^A-Za-z])(?=(?:[^A-Za-z0-9]*[A-Za-z0-9]){6})[^\s"'«»“”<>]{6,64}$/;
  function sembraPassword(v) {
    if (!FORMA_PASSWORD.test(v) || /:\/\/|^www\./i.test(v) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return false;
    const nucleo = v.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    return /\d/.test(nucleo) || /[^A-Za-z0-9]/.test(nucleo);
  }
  function passwordAnnunciata(s, fine, stretto, out) {
    const finestra = s.slice(fine, fine + RAGGIO + 64);
    const re = /\S+/g;
    let t;
    while ((t = re.exec(finestra)) && t.index <= RAGGIO) {
      const v = t[0].replace(/[.,;)»”"']+$/, '');
      if (!sembraPassword(v)) continue;
      if (annunciato(finestra.slice(0, t.index), v, { stretto })) out.push({ valore: v, regola: 'password' });
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
        if (annunciato(s.slice(fine, tutti[k].i), tutti[k].v)) { presi.push(tutti[k]); break; }
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
    const pw = new RegExp(MARCHIO_PASSWORD.source, 'gi');
    while ((parola = pw.exec(s)) && !out.saturo) {
      const fine = parola.index + parola[0].length;
      if (!dentroUnNome(s, parola.index, fine)) passwordAnnunciata(s, fine, true, out);
    }
  }

  // `[{ valore, regola }]` con regola 'codice' | 'password' | 'chiave' | 'iban' | 'carta'. `saturo` sull'elenco: il
  // testo ne aveva più del tetto, e chi controlla un'uscita lì guarda la presenza dei suoi pezzi (urlExfil.js).
  function segretiNelTesto(testoLetto) {
    const s = testo(testoLetto);
    const out = raccolta();
    const fine = () => Object.defineProperty(out.valori, 'saturo', { value: out.saturo });
    if (!s.trim()) return fine();
    for (const re of FORME_CHIAVE) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(s)) && !out.saturo) out.push({ valore: m[0], regola: 'chiave' });
    }
    codiciVicini(s, out);
    for (const m of s.match(IBAN_RE) || []) {
      if (ibanValido(m)) out.push({ valore: m.replace(/\s/g, ''), regola: 'iban' });
    }
    for (const m of s.match(CARTA_RE) || []) {
      if (cartaValida(m)) out.push({ valore: m.replace(/[\s-]/g, ''), regola: 'carta' });
    }
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

  function oscuraTesto(s, chiavi) {
    // Una foto mandata al modello è pixel, non testo: decodificarla costerebbe e non troverebbe niente.
    if (/^data:image\//i.test(s.slice(0, 16))) return s;
    let t = s;
    for (const c of chiavi) {
      t = t.split(c.v).join(OSCURATO);
      t = t.replace(c.re, OSCURATO);
    }
    // Base64 a righe (il comando base64 va a capo ogni 76 caratteri) si legge come un pezzo solo.
    t = t.replace(/[A-Za-z0-9+/=_-]{16,}(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9+/=_-]{4,})+|\S{8,}/g, (tok) => {
      if (/^data:image\//i.test(tok)) return tok;
      const compatto = tok.replace(/\s+/g, '');
      const forme = decodifiche(compatto).map(alnumMinuscolo);
      return chiavi.some((c) => forme.some((f) => f.includes(c.norm) || f.includes(c.rov))) ? OSCURATO : tok;
    });
    // Separatori qualunque fra un carattere e l'altro: si confronta la sola forma alfanumerica e si toglie il tratto originale.
    let piatto = alnumMinuscolo(t);
    for (const c of chiavi) {
      for (const cerca of [c.norm, c.rov]) {
        let guardia = 0;
        while (piatto.includes(cerca) && guardia++ < 1000) {
          const pos = [];
          for (let i = 0; i < t.length; i++) if (/[A-Za-z0-9]/.test(t[i])) pos.push(i);
          const at = piatto.indexOf(cerca);
          t = t.slice(0, pos[at]) + OSCURATO + t.slice(pos[at + cerca.length - 1] + 1);
          piatto = alnumMinuscolo(t);
        }
      }
    }
    return t;
  }

  function oscuraSegreti(valore, segreti) {
    const chiavi = [];
    for (const x of Array.isArray(segreti) ? segreti : []) {
      const v = testo(x).trim();
      const norm = alnumMinuscolo(v);
      if (v.length < SEGRETO_MIN || norm.length < SEGRETO_MIN) continue;
      chiavi.push({ v, norm, rov: rovescio(norm), re: new RegExp(`${escRe(v)}|${escRe(rovescio(v))}`, 'gi') });
    }
    if (!chiavi.length || valore == null) return valore;
    // Lo stesso oggetto quando non c'è niente da togliere: chi lo riceve non paga una copia.
    const giro = (v, n) => {
      if (typeof v === 'string') return oscuraTesto(v, chiavi);
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
    segretiNelTesto, oscuraSegreti, SEGRETO_MIN, OSCURATO,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
