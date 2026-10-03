// Livelli di autonomia (#530): la regola «Filo può fare X?» come DATI, e l'unica funzione che la applica.
// Nessuna superficie decide da sé se un'azione parte, chiede o si ferma: passa da `decideDettaglio`.
// Regole e sentinelle: tests/unit/autonomia.test.mjs; racconto in patterns/azioni-di-filo-livello-di-sicurezza-statico-nel-registro.md.

(function (global) {
  'use strict';

  const LIVELLI = Object.freeze([
    Object.freeze({ id: 'conservativo', nome: 'Conservativo', frase: 'Da solo fa solo quello che resta in chat o si disfa con un gesto. Dopo aver letto cose scritte da altri chiede anche per quelle, e quello che non si disfa non lo fa.' }),
    Object.freeze({ id: 'default', nome: 'Normale', frase: 'Fa da solo quello che si rimedia e ti chiede prima di ciò che non si disfa. Dopo aver letto cose scritte da altri chiede prima di ciò che dura, e per ciò che non si disfa vuole la parola «conferma».' }),
    Object.freeze({ id: 'automatico', nome: 'Automatico', frase: 'Fa da solo quasi tutto e ti chiede solo prima di ciò che non si disfa. Dopo aver letto cose scritte da altri chiede anche prima di ciò che dura.' }),
    Object.freeze({ id: 'yolo', nome: 'Yolo', frase: 'Fa tutto da solo, con un guardiano che rilegge ogni uscita.' }),
  ]);
  const LIVELLO_PREDEFINITO = 'default';

  // Il guardiano dei registri e quello di uscita non esistono ancora: finché mancano, yolo non si sceglie
  // e una cella «+G» chiede invece di partire. Quando arrivano diventano veri qui, e solo qui.
  const GUARDIANO_REGISTRI = false;

  const CLASSI = Object.freeze({
    1: 'Filo e te: la chat, le memorie, le impostazioni, il manifesto, le chat passate',
    2: 'I file su cui lavori: l\'editor, quelli toccati di recente',
    3: 'Autori fidati: mittenti a cui hai risposto o che hai segnato, siti di un autore solo segnati da te',
    4: 'Gli altri file del computer',
    5: 'Autore ignoto: sconosciuti, contatti nuovi, web, ricerche, file scaricati',
  });
  // La classe più alta (meno fidata) che lascia il compito pulito, per livello.
  const SOGLIA_PULITO = Object.freeze({ conservativo: 1, default: 2, automatico: 3, yolo: 3 });

  const COSTI = Object.freeze({
    0: 'Resta in chat',
    1: 'Si disfa: una sveglia, il tema, una scheda archiviata, una bozza non inviata',
    2: 'Dura o si vede fuori, ma si rimedia: una lezione in memoria, una regola di automazione, una mail a un destinatario scelto',
    3: 'Irreversibile o costoso: una mail a uno sconosciuto, un modulo inviato, un acquisto, un file eliminato, un comando che modifica',
  });

  // Costo 0, 1, 2, 3. «si+G» parte da solo dopo il guardiano di uscita: finché non c'è, vale «chiede».
  const TABELLA = Object.freeze({
    conservativo: Object.freeze({
      pulito: Object.freeze(['si', 'si', 'chiede', 'chiede']),
      contaminato: Object.freeze(['si', 'chiede', 'chiede', 'no']),
    }),
    default: Object.freeze({
      pulito: Object.freeze(['si', 'si', 'si', 'chiede']),
      contaminato: Object.freeze(['si', 'si', 'chiede', 'conferma']),
    }),
    automatico: Object.freeze({
      pulito: Object.freeze(['si', 'si', 'si', 'si+G']),
      contaminato: Object.freeze(['si', 'si', 'si+G', 'chiede']),
    }),
    yolo: Object.freeze({
      pulito: Object.freeze(['si', 'si', 'si', 'si+G']),
      contaminato: Object.freeze(['si', 'si+G', 'si+G', 'si+G']),
    }),
  });

  // Sopra la tabella, a ogni livello e da qualunque origine.
  const ELENCO_FISSO = Object.freeze([
    Object.freeze({ id: 'segreto', cosa: 'far uscire un segreto (password, codici usa e getta o di recupero, chiavi, coordinate bancarie che non hai chiesto di mandare)' }),
    Object.freeze({ id: 'molti-destinatari', cosa: 'spedire a molti destinatari insieme' }),
    Object.freeze({ id: 'credenziali', cosa: 'cambiare le credenziali o il recupero di un servizio' }),
    Object.freeze({ id: 'regole', cosa: 'cambiare i livelli di autonomia, le classi delle fonti, i costi o questo elenco' }),
    Object.freeze({ id: 'cancella-definitivo', cosa: 'cancellare dati in modo definitivo' }),
  ]);

  // I campi non hanno un livello proprio: due manopole che possono solo restringere.
  const CAMPI = Object.freeze({
    posta: 'Posta',
    messaggistica: 'Messaggistica',
    file: 'File',
    terminale: 'Terminale',
    web: 'Web',
  });
  const MANOPOLE = Object.freeze({
    diffida: 'Quanto mi fido di ciò che leggo da qui: le fonti del campo scendono di una classe',
    grave: 'Quanto è grave sbagliare qui: le azioni del campo salgono di un costo',
  });

  const RISPOSTE = Object.freeze(['si', 'chiede', 'conferma', 'no', 'propone']);
  const PESO = Object.freeze({ si: 0, 'si+G': 1, chiede: 2, conferma: 3, no: 4 });

  function livelloValido(id) { return Object.prototype.hasOwnProperty.call(SOGLIA_PULITO, id); }
  function livelloDa(id) { return livelloValido(id) ? id : LIVELLO_PREDEFINITO; }
  function selezionabile(id) { return livelloValido(id) && (id !== 'yolo' || GUARDIANO_REGISTRI); }
  function infoLivello(id) { return LIVELLI.find((l) => l.id === livelloDa(id)); }
  function livelliSelezionabili() { return LIVELLI.filter((l) => selezionabile(l.id)); }
  function indice(id) { return LIVELLI.findIndex((l) => l.id === id); }

  function costoValido(c) { return Number.isInteger(c) && c >= 0 && c <= 3; }
  function campoValido(c) { return Object.prototype.hasOwnProperty.call(CAMPI, c); }
  function classeValida(c) { return Number.isInteger(c) && c >= 1 && c <= 5; }

  function manopola(manopole, campo, nome) {
    if (!campoValido(campo) || !manopole || typeof manopole !== 'object') return false;
    const m = manopole[campo];
    return !!(m && typeof m === 'object' && m[nome] === true);
  }

  function costoEffettivo(costo, campo, manopole) {
    return Math.min(3, costo + (manopola(manopole, campo, 'grave') ? 1 : 0));
  }

  // Una fonte: { classe, campo?, chiave?, motivo }. Lo spostamento scelto dall'utente vale prima della
  // manopola del campo, che può solo abbassare la fiducia.
  function classeFonte(fonte, { spostamenti = null, manopole = null } = {}) {
    if (!fonte || !classeValida(fonte.classe)) return 5;
    let c = fonte.classe;
    const spostata = spostamenti && fonte.chiave && Object.prototype.hasOwnProperty.call(spostamenti, fonte.chiave)
      ? spostamenti[fonte.chiave] : null;
    if (classeValida(spostata)) c = spostata;
    if (manopola(manopole, fonte.campo, 'diffida')) c = Math.min(5, c + 1);
    return c;
  }

  // Lo stato del compito lo tiene il motore, da ciò che il compito ha letto: la classe peggiore decide.
  function stato({ fonti = [], livello, spostamenti = null, manopole = null } = {}) {
    let peggiore = null;
    let classe = 1;
    for (const f of Array.isArray(fonti) ? fonti : []) {
      if (!f) continue;
      const c = classeFonte(f, { spostamenti, manopole });
      if (c > classe || !peggiore) { if (c >= classe) { classe = c; peggiore = f; } }
    }
    const soglia = SOGLIA_PULITO[livelloDa(livello)];
    return { stato: classe <= soglia ? 'pulito' : 'contaminato', classe, fonte: classe <= soglia ? null : peggiore };
  }

  function piuStretta(a, b) { return PESO[a] >= PESO[b] ? a : b; }

  // Ingressi: livello, stato ('pulito'|'contaminato'), costo 0-3, dentroPerimetro, origine ('chat'|'automazione'),
  // campo, manopole; più elenco (id dell'elenco fisso colpito) e difesa (l'azione abbassa una difesa), che
  // dichiara chi conosce l'azione. `guardiano` dice se il guardiano di uscita c'è.
  // Esce { risposta, digita, regola, cella }: risposta fra RISPOSTE, digita = va scritta la parola «conferma».
  function decideDettaglio({
    livello, stato: st, costo, dentroPerimetro = true, origine = 'chat', campo = null,
    manopole = null, elenco = '', difesa = false, guardiano = false,
  } = {}) {
    const lv = livelloDa(livello);
    if (!costoValido(costo)) return { risposta: 'no', digita: false, regola: 'costo', cella: 'no' };
    if (elenco) return { risposta: 'no', digita: false, regola: 'elenco', cella: 'no', elenco: String(elenco) };
    const c = costoEffettivo(costo, campo, manopole);
    const contaminato = st !== 'pulito';
    const automazione = origine === 'automazione';
    let cella = TABELLA[lv][contaminato ? 'contaminato' : 'pulito'][c];
    let regola = 'tabella';
    if (!dentroPerimetro) {
      regola = 'perimetro';
      if (automazione) cella = piuStretta(TABELLA[lv].contaminato[c], 'chiede');
      else if (lv === 'conservativo' || lv === 'default') cella = piuStretta(cella, 'chiede');
      else cella = TABELLA[lv].contaminato[c] === 'si' ? 'si+G' : TABELLA[lv].contaminato[c];
    }
    if (difesa && PESO[cella] < PESO.conferma) { cella = 'conferma'; regola = 'difesa'; }
    let risposta = cella;
    if (risposta === 'si+G') risposta = guardiano ? 'si' : 'chiede';
    let digita = risposta === 'conferma';
    if (automazione && (risposta === 'chiede' || risposta === 'conferma')) {
      risposta = 'propone';
      regola = regola === 'tabella' ? 'origine' : regola;
    }
    return { risposta, digita, regola, cella };
  }

  function decide(ingressi) { return decideDettaglio(ingressi).risposta; }

  // Regola (d) per i cambi che fa l'utente: alzare il livello o la fiducia in una fonte vuole «conferma».
  function richiestaCambioLivello(da, a) {
    if (!selezionabile(a)) return 'no';
    return indice(a) > indice(livelloDa(da)) ? 'conferma' : 'si';
  }
  function richiestaSpostamentoFonte(da, a) {
    if (!classeValida(a)) return 'no';
    return classeValida(da) && a < da ? 'conferma' : 'si';
  }

  // ── segreti: controlli deterministici, mai un modello ────────────────────────
  const CHIAVI_API = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /\bAIza[0-9A-Za-z_-]{30,}/,
    /\bglpat-[A-Za-z0-9_-]{20,}/,
    /\btvly-[A-Za-z0-9_-]{16,}/,
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  ];
  const PAROLA_PASSWORD = /(?:password|passwd|pwd|passphrase|parola\s+d['’]ordine|chiave\s+segreta|secret)\s*(?:[:=]|\bè\b|\bis\b|\bera\b)\s*["'«“]?([^\s"'»”,;&]{4,})/gi;
  const PAROLA_CODICE = /(?:\botp\b|\b2fa\b|one[-\s]?time|codic[ei]\s+(?:di\s+|usa\s+e\s+getta|monouso|temporane[oi]|sms)(?:verifica|accesso|sicurezza|conferma|recupero|backup|autenticazione)?|recovery\s+codes?|backup\s+codes?|verification\s+code|security\s+code)\D{0,24}?([A-Za-z0-9]{4,}(?:[-\s][A-Za-z0-9]{4,}){0,9})/gi;

  function sembraPassword(tok) {
    const s = String(tok || '');
    return s.length >= 4 && /[0-9]/.test(s) || /[^A-Za-z0-9À-ÿ]/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s.slice(1)));
  }
  function ibanValido(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let resto = 0;
    for (const ch of r) {
      const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of v) resto = (resto * 10 + Number(d)) % 97;
    }
    return resto === 1;
  }
  function luhn(cifre) {
    let somma = 0;
    for (let i = 0; i < cifre.length; i++) {
      let d = Number(cifre[cifre.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      somma += d;
    }
    return somma % 10 === 0;
  }
  function soloAlnum(s) { return String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }

  // Il segreto che `testo` porterebbe fuori: '' se nessuno. `richiesta` = cosa ha scritto l'utente nel
  // compito: le coordinate bancarie che ci stanno dentro le ha chieste lui, il resto no.
  function segreto(testo, { richiesta = '' } = {}) {
    let t = String(testo || '');
    if (!t.trim()) return '';
    try { t = `${t}\n${decodeURIComponent(t.replace(/\+/g, ' '))}`; } catch (_) {}
    for (const re of CHIAVI_API) if (re.test(t)) return 'chiave';
    for (const m of t.matchAll(PAROLA_PASSWORD)) if (sembraPassword(m[1])) return 'password';
    for (const m of t.matchAll(PAROLA_CODICE)) if (/\d/.test(m[1])) return 'codice';
    const chiesto = soloAlnum(richiesta);
    for (const m of t.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi)) {
      if (ibanValido(m[0]) && !chiesto.includes(soloAlnum(m[0]))) return 'banca';
    }
    for (const m of t.matchAll(/(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g)) {
      const cifre = m[0].replace(/\D/g, '');
      if (cifre.length >= 13 && cifre.length <= 19 && luhn(cifre) && !chiesto.includes(cifre)) return 'banca';
    }
    return '';
  }

  const SEGRETI = Object.freeze({
    chiave: 'una chiave o un token di accesso',
    password: 'una password',
    codice: 'un codice usa e getta o di recupero',
    banca: 'delle coordinate bancarie che non mi hai chiesto di mandare',
  });

  // La frase che il popup aggiunge quando a farlo chiedere è ciò che il compito ha letto.
  function frasePerche(fonte) {
    const cosa = fonte && fonte.motivo ? String(fonte.motivo) : 'ho letto cose scritte da altri';
    return `Te lo chiedo perché in questo compito ${cosa}.`;
  }

  global.SN_AUTONOMIA = Object.freeze({
    LIVELLI, LIVELLO_PREDEFINITO, GUARDIANO_REGISTRI, CLASSI, SOGLIA_PULITO, COSTI, TABELLA,
    ELENCO_FISSO, CAMPI, MANOPOLE, RISPOSTE, SEGRETI,
    livelloValido, livelloDa, selezionabile, infoLivello, livelliSelezionabili,
    costoValido, campoValido, classeValida, costoEffettivo, classeFonte, stato,
    decide, decideDettaglio, richiestaCambioLivello, richiestaSpostamentoFonte,
    segreto, frasePerche,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
