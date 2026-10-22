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
].map((s) => `(?<!\\p{L})${s}(?!\\p{L})`).join('|'), 'iu');
// In chat la password si chiede anche così: parole che le funzioni automatiche non trattano come annuncio di un dato.
// «pass» solo con l'articolo o col wifi: da solo è anche l'inglese «to pass».
const CHIESTA_IN_CHAT = '(?<![\\p{L}\\p{N}])(?:pw|credenziali|(?:l[ae]|mia|tua|sua)\\s+pass|pass\\s+(?:del(?:la)?\\s+)?wi-?fi'
  + '|chiave\\s+(?:(?:del(?:la)?|di)\\s+)?(?:wi-?fi|rete|router))(?![\\p{L}\\p{N}])';
const FINE_FRASE = /[.!?]+(?=\s|$)|\n/g;
// Come apre una risposta, prima del dato: «certo, …», «eccola: …».
const AVVII = new Set(['certo', 'certa', 'certamente', 'sicuro', 'sicura', 'ovvio', 'ovviamente', 'eccola', 'eccolo',
  'eccoti', 'eccotela', 'eccotelo', 'tieni', 'allora', 'dunque', 'comunque', 'subito', 'volentieri', 'figurati', 'prego',
  'grazie', 'scusa', 'scusami', 'aspetta', 'guarda', 'okay', 'sure', 'there', 'sorry', 'thanks']);
const SALUTO = /^(?:ciao+|ehi|ehilà|hey|hi|hello|salve|buongiorno|buonasera)$/;
const PAROLE_RISPOSTA = 12;
const RISPOSTA_MAX = 600;
// Il campo risponde all'ultima richiesta del testo sopra finché dopo di lei non c'è un'altra domanda né molto altro
// (l'ora, «visualizzato», un «aspetta» di chi scrive).
const DOPO_LA_RICHIESTA = 300;
const SOPRA_MAX = 1500;

function presenta() {
  const P = globalThis.SN_URL_EXFIL && globalThis.SN_URL_EXFIL.PRESENTA;
  return P ? [[new RegExp(P.password, 'gu'), 'password'], [new RegExp(CHIESTA_IN_CHAT, 'gu'), 'password'], [new RegExp(P.codice, 'gu'), 'codice']] : [];
}

// Dove finisce ogni richiesta di una password o di un codice nel testo (già minuscolo), e di quale dei due.
function richieste(l) {
  const out = [];
  for (const [re, tipo] of presenta()) {
    for (const m of l.matchAll(re)) {
      const fine = new RegExp(FINE_FRASE.source, 'g');
      fine.lastIndex = m.index + m[0].length;
      const f = fine.exec(l);
      const a = f ? f.index + f[0].length : l.length;
      const frase = () => l.slice(Math.max(0, m.index - 300), m.index).split(/[.!?]+\s|\n/).pop() + l.slice(m.index, a);
      if ((f && f[0].includes('?')) || RICHIESTA.test(frase())) out.push({ fine: a, tipo });
    }
  }
  return out;
}

// Le parole della risposta (già minuscola) contano come quelle dopo la parola che presenta il dato (segretiDetti): con
// cifre o simboli nelle prime PAROLE_RISPOSTA; di sole lettere, per una password, fino alla frase che ne porta uno.
function valoriRisposta(risposta, tipo) {
  const X = globalThis.SN_URL_EXFIL;
  if (!X || !X.segretiDetti) return [];
  const presentata = presenta().map(([re]) => new RegExp(`^(?:${re.source})$`, 'u'));
  const out = [];
  let lettere = tipo === 'password';
  let saluto = false;
  let trovato = false;
  let n = 0;
  for (const [, w, spazio] of risposta.matchAll(/(\S+)(\s*)/g)) {
    if (++n > PAROLE_RISPOSTA) break;
    const t = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    // «Ciao Marco!» non è la password: la frase del saluto non conta per le parole di sole lettere.
    if (!trovato && SALUTO.test(t)) saluto = true;
    // «Marco:», «eccola:» presentano, non sono il dato.
    const candidata = t && !w.endsWith(':') && !AVVII.has(t) && !presentata.some((re) => re.test(t));
    if (candidata && (/[^\p{L}'’]/u.test(t) || (lettere && !saluto))) {
      const v = X.segretiDetti(`${tipo} ${t}`);
      if (v.length) trovato = true;
      out.push(...v);
    }
    if (/[.!?]$/.test(w) || spazio.includes('\n')) { if (saluto) saluto = false; else if (trovato) lettere = false; }
  }
  return out;
}

function richiestaAperta(sopra) {
  const l = sopra.toLowerCase();
  let ultima = null;
  for (const r of richieste(l)) if (!ultima || r.fine > ultima.fine || (r.fine === ultima.fine && r.tipo === 'password')) ultima = r;
  if (!ultima) return null;
  const dopo = l.slice(ultima.fine);
  return dopo.trim().length > DOPO_LA_RICHIESTA || /\?(?=\s|$)/.test(dopo) ? null : ultima.tipo;
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
  const tipo = s ? richiestaAperta(s) : null;
  // Anche pezzo per pezzo: due pezzi incollati possono fondere due numeri in uno che non è più una carta.
  const valori = [...new Set([
    ...[base, ...pezzi].flatMap(valoriDi),
    ...(s ? valoriDi(s) : []),
    ...(tipo ? lunghi(valoriRisposta(base.slice(0, RISPOSTA_MAX).toLowerCase(), tipo)) : []),
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

module.exports = { SEGNAPOSTO, oscura, pezziOscurati, richiestaSenzaRiservati };
