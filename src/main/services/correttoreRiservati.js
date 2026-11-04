// Chiavi, password, codici e numeri di carta scritti in un campo non partono verso i modelli del correttore (#1446): al
// loro posto va un segnaposto e il resto si controlla lo stesso. Le forme le riconoscono guardianoStatico.js e urlExfil.js.
// Si cercano nel campo intero e nel testo sopra, mai pezzo per pezzo. Prove: tests/unit/correttoreRiservati.test.mjs.
'use strict';

const SEGNAPOSTO = '[dato riservato]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GRUPPI_DI_CARTA = /(?<![\p{L}\p{N}])\d{4}(?: \d{4})+(?![\p{L}\p{N}])/gu;

// Chi risponde a chi chiede una password o un codice non lo annuncia («certo, Gatto2024»): lo annuncia la domanda, o la
// richiesta senza punto di domanda, che in chat è la forma comune («mi mandi la password», «mandami il pin», «hai la
// password del wifi», «qual è il codice», «send me the code»). Prove: tests/unit/correttoreRiservati.test.mjs.
const RICHIESTA = new RegExp([
  '(?:(?:(?:mand|invi|pass|gir|ricord)a|scriv[ei])r?|d[ai][rm])m(?:i|el[ao])',
  '(?:mi|ci|me\\s*l[aoe\'’]?|ce\\s*l[aoe\'’]?)\\s*(?:(?:mand|invi|scriv|gir|pass|ricord|prest|condivid|mostr|dett|incoll|cop)(?:i|ate|ete|eresti|ereste)|dic?i|dite|da[it]?e?|daresti|diresti)',
  '(?:puoi|può|potresti|potete|potreste|riesci|riusciresti|sai|sapete|sapresti|hai|avete|conosci|ce\\s*l[\'’]?hai|qual(?:e|[\'’]\\s*è)?|(?:com|cos)[\'’]\\s*è)',
  '(?:(?:mi|ci) serv(?:e|irebbe)|ho bisogno|per\\s*favore|perfavore|x\\s*favore|pls|plz|please)',
  '(?:send|give|tell|share|what|need|can\\s+you|could\\s+you|do\\s+you)',
  // «ti ricordi la password», «come è la password», «che password ha il wifi», «e la password del wifi».
  '(?:(?:ti|vi)\\s+ricord(?:i|ate)|ricordi\\s+(?:la|il)|come\\s+(?:è|e[\'’]|era)|che\\s+(?:password|pw|pass|pin|codice)|(?:^|:\\s*)e\\s+(?:la|il))',
].map((s) => `(?<!\\p{L})${s}(?!\\p{L})`).join('|'), 'iu');
// In chat la password si chiama anche così: «pass» solo con l'articolo o col wifi, da solo è anche l'inglese «to pass».
const ETICHETTE_CORTE = '(?<![\\p{L}\\p{N}])(?:pw|(?:l[ae]|mia|tua|sua)\\s+pass|pass\\s+(?:del(?:la)?\\s+)?wi-?fi'
  + '|chiave\\s+(?:(?:del(?:la)?|di)\\s+)?(?:wi-?fi|rete|router))(?![\\p{L}\\p{N}])';
const CHIESTA_IN_CHAT = `${ETICHETTE_CORTE}|(?<![\\p{L}\\p{N}])credenziali(?![\\p{L}\\p{N}])`;
const FINE_FRASE = /[.!?]+(?=\s|$)|\n/g;
const FRASE_MAX = 300;
// Come apre una risposta, prima del dato: «certo, …», «eccola: …».
const AVVII = new Set(['certo', 'certa', 'certamente', 'sicuro', 'sicura', 'ovvio', 'ovviamente', 'eccola', 'eccolo',
  'eccoti', 'eccotela', 'eccotelo', 'tieni', 'allora', 'dunque', 'comunque', 'subito', 'volentieri', 'figurati', 'prego',
  'grazie', 'scusa', 'scusami', 'aspetta', 'guarda', 'okay', 'sure', 'there', 'sorry', 'thanks', 'ecco']);
// Le parole che annunciano il dato subito dopo («…non me la ricordo mai, era gattonero»): un elenco solo per la risposta
// in chat e per le forme libere.
const ANNUNCI = ['è', "e'", 'e’', 'era', 'sarebbe', 'is', 'was'];
const ANNUNCIO = `(?:${ANNUNCI.map(esc).join('|')})`;
const PRESENTA_DATO = new Set([...ANNUNCI, '=', 'ecco', 'eccola', 'eccolo', 'eccotela', 'eccotelo']);
const SALUTO = /^(?:ciao+|ehi|ehilà|hey|hi|hello|salve|buongiorno|buonasera)$/;
// Una parola di sole lettere conta come password solo nelle prime parole della risposta o dopo PRESENTA_DATO: più in là
// è il resto del messaggio. Quelle con cifre o simboli contano fino a RISPOSTA_MAX.
const PAROLE_RISPOSTA = 12;
const RISPOSTA_MAX = 2000;
// Il campo risponde all'ultimo messaggio che nomina la password finché sopra non c'è già una risposta (chiusa) e non
// c'è molto altro: solleciti, seconde domande e altre persone non sciolgono il legame (#1446.4). Nella pagina vera fra
// i solleciti stanno orari e messaggi senza nome: il tetto regge una decina di messaggi.
const DOPO_LA_RICHIESTA = 1000;
const SOPRA_MAX = 1500;
// «Marco: …» a inizio riga: chi scrive il messaggio.
const PARLA = /^[^\S\n]*(\p{L}[\p{L}\p{N} ._'’-]{0,30}?)[^\S\n]*:\s/u;

function presenta() {
  const P = globalThis.SN_URL_EXFIL && globalThis.SN_URL_EXFIL.PRESENTA;
  return P ? [[new RegExp(P.password, 'gu'), 'password'], [new RegExp(CHIESTA_IN_CHAT, 'gu'), 'password'], [new RegExp(P.codice, 'gu'), 'codice']] : [];
}

// «pasword», «passowrd», «pssword»: chi chiede in chat sbaglia la parola e non la corregge. Al più due errori, e la
// parola resta quella che comincia per p e finisce per d («passport» no).
const NOVITA = () => globalThis.SN_NOVITA || (require('../../shared/novita.js'), globalThis.SN_NOVITA);
function refusoDiPassword(w) {
  if (w === 'password' || w.length < 6 || w.length > 10 || w[0] !== 'p' || !w.endsWith('d')) return false;
  return NOVITA().distanza(w, 'password', 2) <= 2;
}

// I nomi della password: quelli che il filtro riconosce già (urlExfil), «pw», «pass» e i refusi di «password».
let soloNomePassword = null;
function nomeDiPassword(w) {
  const P = globalThis.SN_URL_EXFIL && globalThis.SN_URL_EXFIL.PRESENTA;
  if (!soloNomePassword && P) soloNomePassword = new RegExp(`^(?:${P.password.replace(/^\\b|\\b$/g, '')}|pw|pass)$`, 'u');
  return (soloNomePassword ? soloNomePassword.test(w) : w === 'password') || refusoDiPassword(w);
}

// Dove il testo (già minuscolo) nomina una password o un codice.
function menzioni(l) {
  const out = [];
  const P = presenta();
  for (const [re, tipo] of P) for (const m of l.matchAll(re)) out.push({ i: m.index, j: m.index + m[0].length, tipo });
  if (P.length) for (const m of l.matchAll(/(?<![\p{L}\p{N}])p\p{L}{4,9}(?![\p{L}\p{N}])/gu)) {
    if (refusoDiPassword(m[0])) out.push({ i: m.index, j: m.index + m[0].length, tipo: 'password' });
  }
  return out;
}

// Dove finisce ogni frase che chiede una password o un codice (con `tutte`, anche ogni frase che nomina una password).
function richieste(l, tutte = false) {
  const out = [];
  for (const m of menzioni(l)) {
    // La frase si cerca in un tratto corto: un testo lungo senza punti, con la parola ripetuta, non diventa quadratico.
    const f = new RegExp(FINE_FRASE.source, 'g').exec(l.slice(m.j, m.j + FRASE_MAX));
    const a = f ? m.j + f.index + f[0].length : Math.min(l.length, m.j + FRASE_MAX);
    const frase = () => l.slice(Math.max(0, m.i - FRASE_MAX), m.i).split(/[.!?]+\s|\n/).pop() + l.slice(m.i, a);
    const chiesta = !!((f && f[0].includes('?')) || RICHIESTA.test(frase()));
    if (chiesta || (tutte && m.tipo === 'password')) out.push({ inizio: m.i, fine: a, tipo: m.tipo, chiesta });
  }
  return out;
}

// Le parole della risposta (già minuscola) contano come quelle dopo la parola che presenta il dato (segretiDetti):
// quelle con cifre o simboli fino alla frase che porta il dato; quelle di sole lettere, per una password chiesta, nelle
// prime PAROLE_RISPOSTA o dopo PRESENTA_DATO.
function valoriRisposta(risposta, tipo, chiesta = true) {
  const X = globalThis.SN_URL_EXFIL;
  if (!X || !X.segretiDetti) return [];
  const presentata = presenta().map(([re]) => new RegExp(`^(?:${re.source})$`, 'u'));
  const out = [];
  let lettere = tipo === 'password' && chiesta;
  let saluto = false;
  let trovato = false;
  // Un dato con cifre o simboli è la risposta: dopo la sua frase il messaggio parla d'altro.
  let forte = false;
  let dopoPresenta = false;
  let n = 0;
  for (const [, w, spazio] of risposta.matchAll(/(\S+)(\s*)/g)) {
    n += 1;
    const t = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    // «Ciao Marco!» non è la password: la frase del saluto non conta per le parole di sole lettere.
    if (!trovato && SALUTO.test(t)) saluto = true;
    // «Marco:», «eccola:» presentano, non sono il dato.
    const candidata = t && !w.endsWith(':') && !AVVII.has(t) && !PRESENTA_DATO.has(t) && !presentata.some((re) => re.test(t));
    const segni = /[^\p{L}'’]/u.test(t);
    const qualunque = tipo === 'password' && !saluto && !forte && ((lettere && n <= PAROLE_RISPOSTA) || dopoPresenta);
    if (candidata && (segni || qualunque)) {
      const v = X.segretiDetti(`${tipo} ${t}`);
      if (v.length) { trovato = true; if (segni) forte = true; }
      out.push(...v);
    }
    dopoPresenta = w.endsWith(':') || PRESENTA_DATO.has(t);
    if (/[.!?]$/.test(w) || spazio.includes('\n')) {
      if (saluto) saluto = false;
      else if (forte) break;
      else if (trovato) lettere = false;
    }
  }
  return out;
}

const chiParla = (riga) => { const m = riga.match(PARLA); return m ? m[1].trim() : null; };
// Dopo il messaggio di `r` ha scritto un altro (di solito chi sta rispondendo adesso).
function altroDopo(l, r) {
  const inizioRiga = l.lastIndexOf('\n', r.inizio - 1) + 1;
  const fineRiga = l.indexOf('\n', r.inizio);
  const chi = chiParla(l.slice(inizioRiga, fineRiga < 0 ? l.length : fineRiga));
  const righe = l.slice(r.fine).split('\n');
  if (r.fine > 0 && l[r.fine - 1] !== '\n') righe.shift();
  return righe.some((riga) => { const c = chiParla(riga); return c !== null && c !== chi; });
}

// Il messaggio sopra il campo a cui il campo risponde: { tipo, chiesta } o null.
function richiestaAperta(sopra) {
  const l = sopra.toLowerCase();
  const tutte = richieste(l, true);
  let ultima = null;
  for (const r of tutte) {
    const meglio = !ultima || r.fine > ultima.fine
      || (r.fine === ultima.fine && (r.tipo === 'password') > (ultima.tipo === 'password'))
      || (r.fine === ultima.fine && r.tipo === ultima.tipo && r.chiesta && !ultima.chiesta);
    if (meglio) ultima = r;
  }
  if (!ultima || l.slice(ultima.fine).trim().length > DOPO_LA_RICHIESTA || altroDopo(l, ultima)) return null;
  // Una richiesta vera prima di un sollecito che rinomina la password vale ancora: conta come chiesta.
  const chiesta = tutte.some((r) => r.chiesta && r.tipo === ultima.tipo && !altroDopo(l, r));
  return { tipo: ultima.tipo, chiesta };
}

// Le password scritte a mano fuori dal posto di un'etichetta (#1649): accanto al nome utente, dopo il nome della rete,
// dopo «pw» o «la pass» in una frase, dopo «, è». Conta solo il posto del valore, mai le parole vicine all'etichetta: i
// nomi di prodotto e il codice intorno restano (#1589). Prove: tests/unit/correttorePasswordAMano.test.mjs.
const PW = '(?:password|passwd|pwd|psw|pw|pass|passphrase|passcode)';
const UTENTE = '(?:username|user|utente|nome\\s+utente|login|e-?mail|mail|account)';
const LIBERE = {
  // «Username / Password: mario / Girasole2024»: il valore sta al posto dell'etichetta della password.
  coppia: new RegExp(`(?<![\\p{L}\\p{N}])(${UTENTE}|${PW})\\s*/\\s*(${UTENTE}|${PW})\\s*[:=]\\s*(\\S+?)\\s*/\\s*(\\S+)`, 'gu'),
  credenziali: /(?<![\p{L}\p{N}])(?:credenziali|credentials|dati\s+(?:di\s+)?(?:accesso|login))\s*[:=]\s*(\S+?)\s*\/\s*(\S+)/gu,
  accedi: /(?<![\p{L}\p{N}])(?:accedi|entra|login|log\s*in|sign\s*in)\s+(?:con|with)\s*:?\s*(\S+?)\s*\/\s*(\S+)/gu,
  // «Wi-Fi: CasaRossi - Faro7Blu55»: prima la rete, poi la chiave. Il nome della rete può avere spazi (32 caratteri al più).
  rete: /(?<![\p{L}\p{N}])(?:wi-?fi|wlan|ssid)\s*[:=]\s*([^\n]{1,32}?)\s+[-–—/|]\s+(\S+)/gu,
  // «SSID: CasaRossi» e sotto «Key: Brezza7Mare», o sulla stessa riga.
  chiaveRete: /(?<![\p{L}\p{N}])(?:ssid|nome\s+(?:della\s+)?rete|network(?:\s+name)?|wi-?fi|wlan)\s*[:=][^\n]*?(?:[^\S\n]*[,;|/][^\S\n]*|[^\S\n]+|[^\S\n]*\n(?:[^\S\n]*\n)?[^\S\n]*)(?:key|chiave(?:\s+(?:di\s+rete|wpa2?))?|password|pass|pw|psk|wpa2?(?:\s+key)?)\s*[:=]\s*(\S+)/gu,
  corte: new RegExp(ETICHETTE_CORTE, 'gu'),
  // «la password su whatsapp, (comunque) è Girasole2024»: il valore dopo la virgola.
  virgola: new RegExp(`(?<![\\p{L}\\p{N}])(?:${PW}|${ETICHETTE_CORTE})[^\\n.!?]{0,80}?,\\s*(?:[\\p{L}'’]+\\s+){0,2}?(?:è|e'|e’|era|is|sarebbe)\\s+(\\S+)`, 'gu'),
};
const SOLO_PW = new RegExp(`^${PW}$`, 'u');
// Dopo un'etichetta corta una parola qualunque è il resto della frase («la pass giornaliera», «il pw del documento»):
// conta se ha la forma di una password, o se la presenta «è» o i due punti; dopo «pw» anche se viene subito.
const PRESENTATA = /^\s*(?:(?:del(?:la)?|dell['’]|di)\s+[\p{L}\p{N}-]+\s*)?(?:[:=]|è|e['’]|era|is|sarebbe)\s*$/u;
const ACCANTO = /^\s*$/u;

function formeLibere(testo) {
  const X = globalThis.SN_URL_EXFIL;
  const G = globalThis.SN_GUARDIANO_STATICO;
  if (!X || !X.segretiDetti) return [];
  const l = String(testo || '').toLowerCase();
  const pulito = (v) => String(v || '').replace(/[.,;:!?)\]»”"']+$/u, '');
  const valore = (v) => X.segretiDetti(`password ${pulito(v)}`);
  const forma = (v) => (G && G.sembraPassword && G.sembraPassword(pulito(v)) ? [{ valore: pulito(v) }] : []);
  const out = [];
  for (const m of l.matchAll(LIBERE.coppia)) {
    const [a, b] = [SOLO_PW.test(m[1]), SOLO_PW.test(m[2])];
    if (a !== b) out.push(...valore(b ? m[4] : m[3]));
  }
  for (const m of l.matchAll(LIBERE.credenziali)) out.push(...valore(m[2]));
  for (const m of l.matchAll(LIBERE.accedi)) out.push(...forma(m[2]));
  for (const m of l.matchAll(LIBERE.rete)) out.push(...forma(m[2]));
  for (const m of l.matchAll(LIBERE.chiaveRete)) out.push(...valore(m[1]));
  for (const m of l.matchAll(LIBERE.corte)) {
    const coda = l.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const pw = /^pw$/u.test(m[0]);
    for (const v of X.segretiDetti(`password ${coda}`)) {
      const s = valoreDi(v);
      const fra = coda.slice(0, Math.max(0, coda.indexOf(s)));
      if (forma(s).length || PRESENTATA.test(fra) || (pw && ACCANTO.test(fra))) out.push(v);
    }
  }
  for (const m of l.matchAll(LIBERE.virgola)) out.push(...forma(m[1]));
  return out;
}

const valoreDi = (x) => String((x && x.valore) || '');
const lunghi = (vs) => vs.map(valoreDi).filter((v) => v.length >= 4);

function riservati(testo) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const X = globalThis.SN_URL_EXFIL;
  const out = [];
  const l = testo.toLowerCase();
  try { if (G && G.segretiNelTesto) out.push(...G.segretiNelTesto(testo)); } catch (_) {}
  try { if (X && X.segretiDetti) out.push(...X.segretiDetti(l)); } catch (_) {}
  try { out.push(...formeLibere(l)); } catch (_) {}
  try {
    // Un testo lungo che ripete la stessa domanda e la stessa risposta si legge una volta sola.
    const viste = new Set();
    for (const r of richieste(l)) {
      const risposta = l.slice(r.fine, r.fine + RISPOSTA_MAX);
      const k = `${r.tipo}:${risposta}`;
      if (!viste.has(k)) { viste.add(k); out.push(...valoriRisposta(risposta, r.tipo)); }
    }
  } catch (_) {}
  // Una carta mentre la si scrive: due gruppi da quattro cifre sono già metà numero, e il resto arriva al controllo dopo.
  for (const m of testo.matchAll(GRUPPI_DI_CARTA)) out.push({ valore: m[0].replace(/ /g, '') });
  return lunghi(out);
}


// Un numero di carta si scrive anche a gruppi («4111 1111 …»): fra una cifra e l'altra può stare uno spazio o un trattino.
// Una parola di sole lettere vale intera: il «camera» di una risposta non tocca «cameraman».
function formaDi(valore) {
  if (/^\d+$/.test(valore)) return new RegExp(valore.split('').join('[\\s-]?'), 'gi');
  if (/^\p{L}+$/u.test(valore)) return new RegExp(`(?<![\\p{L}\\p{N}])${valore}(?![\\p{L}\\p{N}])`, 'giu');
  return new RegExp(esc(valore), 'gi');
}
const valoriDi = (testo) => [...new Set(riservati(testo))].sort((a, b) => b.length - a.length);

function oscura(testo, valori = null) {
  let v = String(testo == null ? '' : testo);
  if (!v.trim()) return v;
  for (const valore of valori || valoriDi(v)) v = v.replace(formaDi(valore), SEGNAPOSTO);
  return v;
}

// I pezzi contigui del campo (prima, nuovo, dopo), oscurati sul campo intero: la parola che presenta una password, o
// metà di un numero di carta, può stare in un pezzo diverso dal valore, o fuori dai pezzi. `campo` e `campoDa` (dove
// comincia il primo pezzo) li manda la pagina; se non tornano coi pezzi vale il loro testo unito.
function pezziOscurati(pezzi, campo, campoDa, sopra = '') {
  const unito = pezzi.join('');
  const daCampo = typeof campo === 'string' && Number.isInteger(campoDa) && campoDa >= 0
    && campo.slice(campoDa, campoDa + unito.length) === unito;
  const base = daCampo ? campo : unito;
  const scarto = daCampo ? campoDa : 0;
  // Sopra il campo stanno la domanda a cui risponde e il messaggio che ha già detto il dato.
  const s = typeof sopra === 'string' ? sopra.slice(-SOPRA_MAX) : '';
  const aperta = s ? richiestaAperta(s) : null;
  // Anche pezzo per pezzo: due pezzi incollati possono fondere due numeri in uno che non è più una carta.
  const valori = [...new Set([
    ...[base, ...pezzi].flatMap(valoriDi),
    ...(s ? valoriDi(s) : []),
    ...(aperta ? lunghi(valoriRisposta(base.slice(0, RISPOSTA_MAX).toLowerCase(), aperta.tipo, aperta.chiesta)) : []),
  ])].sort((x, y) => y.length - x.length);
  const coperti = [];
  for (const valore of valori) for (const m of base.matchAll(formaDi(valore))) coperti.push([m.index - scarto, m.index - scarto + m[0].length]);
  let a = 0;
  const out = pezzi.map((pezzo) => {
    const da = a;
    a += pezzo.length;
    const qui = coperti.map(([x, y]) => [Math.max(x, da) - da, Math.min(y, a) - da]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    const uniti = [];
    for (const [x, y] of qui) {
      const ultimo = uniti[uniti.length - 1];
      if (ultimo && x <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], y); else uniti.push([x, y]);
    }
    let v = '';
    let i = 0;
    for (const [x, y] of uniti) { v += pezzo.slice(i, x) + SEGNAPOSTO; i = y; }
    return v + pezzo.slice(i);
  });
  return { pezzi: out, valori };
}

// Le parti di una richiesta del correttore che portano testo: quello del campo, i candidati, la pagina intorno. Il campo
// intero e il testo sopra servono solo qui: non partono.
function richiestaSenzaRiservati(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = { ...p };
  delete out.campo;
  delete out.campoDa;
  delete out.sopra;
  // Il testo sopra lo legge la pagina a ogni richiesta; senza, vale quello che parte con lei.
  const sopra = [p.sopra, p.contesto && p.contesto.prima, p.luogo && p.luogo.conversazione].find((t) => typeof t === 'string') || '';
  const chiavi = ['prima', 'nuovo', 'dopo'];
  const { pezzi, valori } = pezziOscurati(chiavi.map((k) => (typeof p[k] === 'string' ? p[k] : '')), p.campo, p.campoDa, sopra);
  chiavi.forEach((k, i) => { if (typeof p[k] === 'string') out[k] = pezzi[i]; });
  const delCampo = (t) => oscura(oscura(t, valori));
  if (Array.isArray(p.candidati)) out.candidati = p.candidati.map((c) => (c && typeof c === 'object' ? { ...c, pezzo: delCampo(c.pezzo) } : c));
  if (p.luogo && typeof p.luogo === 'object') {
    out.luogo = { ...p.luogo };
    for (const k of ['titolo', 'conversazione']) if (typeof p.luogo[k] === 'string') out.luogo[k] = delCampo(p.luogo[k]);
  }
  if (p.contesto && typeof p.contesto === 'object') {
    out.contesto = { ...p.contesto };
    for (const k of ['prima', 'dopo']) if (typeof p.contesto[k] === 'string') out.contesto[k] = delCampo(p.contesto[k]);
  }
  return out;
}

module.exports = { SEGNAPOSTO, oscura, pezziOscurati, richiestaSenzaRiservati, formeLibere };
