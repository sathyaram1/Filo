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
  // MONOUSO, che nessuno usa per il cancello di casa (#536).
  const MARCHI_MONOUSO = new RegExp(
    '(?:\\botp\\b|\\bmfa\\b|\\b2fa\\b|one[\\s-]?time'
    + '|(?:codic|chiav|password|passphrase)\\w*\\s+(?:di\\s+|da\\s+)?'
    + '(?:recupero|ripristino|temporane\\w+|monouso|usa\\s+e\\s+getta)'
    + '|(?:recovery|backup|one[\\s-]?time)\\s+code)',
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
      if (luhn(m)) {
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
  // Per i codici conta solo ciò che sta vicino alla sua parola, così un telefono, una data o
  // un numero d'ordine sparsi nella pagina non diventano segreti.

  // Blocchi prima delle cifre: «7563 0192» è un codice di recupero, non due numeri.
  const CANDIDATO = new RegExp(`\\b(?:${BLOCCHI}|${MISTO}|${CIFRE})\\b`, 'g');
  const PEZZO_CODICE = new RegExp(`^(?:${CIFRE}|${MISTO}|[A-Za-z0-9]{4,6}(?:-[A-Za-z0-9]{4,6}){1,5})$`);
  // Fra due codici di un elenco ci sono a capo, spazi, puntini o numeri di riga: una parola
  // in mezzo vuol dire che il numero dopo parla d'altro.
  const FRA_CODICI = /^[\s\d.,;:)(•·*-]{0,40}$/;
  // Largo: il costo resta lineare nel testo anche su una pagina da milioni di caratteri.
  const MAX_ESTRATTI = 100000;

  // Un anno o un pezzo di data, ora o importo («30/09/2026», «1234,50») non è un codice.
  function pezzoDiData(s, i, j, v) {
    if (/^(?:19|20)\d{2}$/.test(v)) return true;
    return /\d[/.:,]$/.test(s.slice(Math.max(0, i - 2), i)) || /^[/.:,]\d/.test(s.slice(j, j + 2));
  }

  // I pezzi di un candidato che hanno la forma di un codice, più le coppie vicine: un codice
  // di recupero «7563 0192» può uscire anche come «75630192».
  function pezzi(s, m) {
    const out = [];
    const re = /\S+/g;
    let t;
    let prima = null;
    while ((t = re.exec(m[0]))) {
      const i = m.index + t.index;
      const j = i + t[0].length;
      const buono = PEZZO_CODICE.test(t[0]) && !pezzoDiData(s, i, j, t[0]);
      if (buono) {
        out.push(t[0]);
        if (prima && prima.j + 1 === i) out.push(s.slice(prima.i, j));
      }
      prima = buono ? { i, j } : null;
    }
    return out;
  }

  // Tutti i candidati del testo in una passata sola: cercarli di nuovo per ogni parola rendeva
  // il costo quadratico, e una pagina lunga sul 2FA teneva fermo il processo per secondi.
  function candidatiDi(s) {
    const out = [];
    const re = new RegExp(CANDIDATO.source, 'g');
    let m;
    while ((m = re.exec(s))) {
      const p = pezzi(s, m);
      if (p.length) out.push({ i: m.index, j: m.index + m[0].length, pezzi: p });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  // Il codice è quello che la parola annuncia: fra i due c'è niente, un «è», un «:», un «is».
  // In «un OTP generato da un'app, secondo la RFC 6238» il numero è della norma.
  const ATTACCO = /(?:^|[:=]|(?:^|[\s(])(?:è|e'|is|are|was|sono|ecco|here|vale|risulta|seguente|seguenti|following))$/i;
  const ALTRA_FRASE = /[.!?]\s+[A-ZÀ-Ý]/;
  function annunciato(fra) {
    if (ALTRA_FRASE.test(fra)) return false;
    return ATTACCO.test(fra.replace(/(?:\s*(?:\d{1,3}[.)]|[•·*"'«»“”(-]))*\s*$/, ''));
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
  // «one-time» da solo è un acquisto o un pagamento: annuncia un codice solo se lo nomina.
  const ONE_TIME_CODICE = /^[\s-]+(?:use[\s-]+)?(?:[a-z]+[\s-]+)?(?:password|pass\s?code|code|pin)\b/i;

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
    while ((parola = cerca.exec(s)) && out.length < MAX_ESTRATTI) {
      const inizio = parola.index;
      let fine = inizio + parola[0].length;
      if (dentroUnNome(s, inizio, fine)) continue;
      if (/^one[\s-]?time$/i.test(parola[0])) {
        const coda = ONE_TIME_CODICE.exec(s.slice(fine, fine + 40));
        if (!coda) continue;
        fine += coda[0].length;
      }
      if (!tutti) tutti = candidatiDi(s);
      const regola = /pass/i.test(s.slice(inizio, fine)) ? 'password' : 'codice';
      const presi = [];
      let k = primo(fine);
      for (; k < tutti.length && tutti[k].i < fine + RAGGIO; k++) {
        if (annunciato(s.slice(fine, tutti[k].i))) { presi.push(tutti[k]); break; }
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
    }
  }

  // `[{ valore, regola }]` con regola 'codice' | 'password' | 'chiave' | 'iban' | 'carta'.
  function segretiNelTesto(testoLetto) {
    const s = testo(testoLetto);
    const out = [];
    if (!s.trim()) return out;
    for (const re of FORME_CHIAVE) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(s)) && out.length < MAX_ESTRATTI) out.push({ valore: m[0], regola: 'chiave' });
    }
    codiciVicini(s, out);
    for (const m of s.match(IBAN_RE) || []) {
      if (ibanValido(m)) out.push({ valore: m.replace(/\s/g, ''), regola: 'iban' });
    }
    for (const m of s.match(CARTA_RE) || []) {
      if (luhn(m)) out.push({ valore: m.replace(/[\s-]/g, ''), regola: 'carta' });
    }
    const visti = new Set();
    return out.filter((x) => {
      const k = `${x.regola}:${x.valore.toLowerCase()}`;
      if (visti.has(k)) return false;
      visti.add(k);
      return true;
    });
  }

  // ── I segreti custoditi non entrano in un prompt (#810) ──────────────────
  // Il cancello dei modelli passa ogni messaggio di qui: un comando che stampa la chiave di
  // Opzioni non la mette davanti al modello, che così non la può far uscire.
  const OSCURATO = '[segreto custodito da Filo]';

  function oscuraSegreti(valore, segreti) {
    const lista = (Array.isArray(segreti) ? segreti : [])
      .map((x) => testo(x).trim())
      .filter((x) => x.length >= SEGRETO_MIN);
    if (!lista.length || valore == null) return valore;
    let tutto = '';
    try { tutto = JSON.stringify(valore); } catch (_) { return valore; }
    if (!lista.some((x) => tutto.includes(x))) return valore;
    const giro = (v, n) => {
      if (typeof v === 'string') return lista.reduce((acc, x) => acc.split(x).join(OSCURATO), v);
      if (n > 12 || !v || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map((x) => giro(x, n + 1));
      const o = {};
      for (const k of Object.keys(v)) o[k] = giro(v[k], n + 1);
      return o;
    };
    return giro(valore, 0);
  }

  global.SN_GUARDIANO_STATICO = {
    controlla, ibanValido, luhn, hostNominato, hostDi, stessoSito, linkNelTesto,
    segretiNelTesto, oscuraSegreti, SEGRETO_MIN, OSCURATO,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
