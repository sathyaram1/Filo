// I controlli che fermano un avviso SENZA chiedere a nessun modello (#536).
// Devono funzionare a rete staccata e sbagliare di rado: solo forme che non
// hanno nessuna ragione di comparire in un avviso onesto.

(function (global) {
  'use strict';

  // Un segreto più corto di così è una parola, non una chiave: confrontarlo
  // fermerebbe avvisi innocui che la contengono per caso.
  const SEGRETO_MIN = 12;

  // Le parole che qualificano un numero come credenziale. Il «codice» da solo
  // non basta — un codice d'ordine in una mail di spedizione è normale — e un
  // guardiano che grida al lupo viene spento.
  const PAROLE_CODICE = new RegExp(
    '(?:\\botp\\b|\\bmfa\\b|\\b2fa\\b|one[\\s-]?time'
    + '|codic\\w*\\s+(?:di\\s+)?(?:verifica|sicurezza|accesso|conferma|autenticazione|recupero|ripristino|temporane\\w+|monouso)'
    + '|codic\\w*\\s+usa\\s+e\\s+getta'
    + '|(?:verification|security|recovery|access|login|backup)\\s+code'
    + '|\\bpin\\b|password|passphrase|parola\\s+d\'?ordine'
    + '|chiav\\w*\\s+(?:di\\s+)?(?:recupero|ripristino|accesso))',
    'i',
  );

  // Un gruppo che ha la forma di un codice: cifre, blocchi separati da trattino
  // come li scrivono i codici di recupero, o un gruppo che mescola lettere e
  // cifre — che è la forma di una password scritta per esteso.
  const FORMA_CODICE = new RegExp(
    '\\b(?:\\d{4,10}'
    + '|[A-Za-z0-9]{4,6}(?:[-\\s][A-Za-z0-9]{4,6}){1,5}'
    + '|(?=[A-Za-z0-9]{6,24}\\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\\d)[A-Za-z0-9]{6,24}'
    + ')\\b',
  );

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

  // Due host vanno d'accordo se uno è l'altro, o un suo sottodominio: la coda
  // è il sito, quindi `accedi.banca.it` sotto la scritta `banca.it` è onesto,
  // mentre `banca.it.altrove.invalid` non lo è (vedi il pattern «Un
  // collegamento dice dove porta»).
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

  // Esito unico: { blocca, regola, motivo }. `motivo` è la coda della riga che
  // legge l'utente («Ho fermato un avviso nato da X: …») e non riporta mai un
  // pezzo del testo esaminato — quello lo scrive chi attacca.
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
    const cerca = new RegExp(PAROLE_CODICE.source, 'gi');
    let parola;
    while ((parola = cerca.exec(s))) {
      const i = parola.index;
      const prima = s.slice(Math.max(0, i - RAGGIO), i);
      const dopo = s.slice(i + parola[0].length, i + parola[0].length + RAGGIO);
      if (FORMA_CODICE.test(prima) || FORMA_CODICE.test(dopo)) {
        return { blocca: true, regola: 'codice', motivo: 'conteneva un codice di accesso o una password' };
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

  global.SN_GUARDIANO_STATICO = {
    controlla, ibanValido, luhn, hostNominato, hostDi, stessoSito, linkNelTesto,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
