// Imitazioni di un marchio nel nome di un sito: i candidati li dà l'elenco dei marchi (brands.js), il verdetto un
// classificatore sulle lettere, locale e sincrono (il nome non esce dal computer). Un verdetto solo per l'apertura della
// pagina e per l'avviso sui link. Rigenerare il modello: scripts/addestra-imitazioni.mjs; prove: tests/unit/imitazioni.test.mjs.

'use strict';

const fs = require('fs');
const path = require('path');
const { BRANDS, LEGIT_DOMAINS, MARCHI_PAROLA, soloTruffa } = require('./brands');
const { MAP: CONFONDIBILI } = require('./confusables');

const FILE_MODELLO = path.join(__dirname, 'imitazioni.bin');

// Quante lettere sbagliate un marchio regge senza diventare un'altra parola: sotto le cinque nessuna (wise/wine).
function tolleranza(lunghezza) {
  if (lunghezza < 5) return 0;
  return lunghezza >= 8 ? 2 : 1;
}

const MARCHI = BRANDS.map((b) => ({
  brand: b,
  token: b.token,
  soglia: tolleranza(b.token.length),
  parola: MARCHI_PAROLA.has(b.token),
}));

// Lo scheletro di un'etichetta (come si legge a schermo, confusables.js) con, per ogni lettera, da dove viene: serve a
// dire cosa resta intorno al marchio e se il marchio occupa un pezzo intero fra due trattini.
function scheletroDi(etichetta) {
  let testo = '';
  let straniere = false;
  let cifre = false;
  const tagli = [0];
  for (const ch of etichetta.normalize('NFC').toLowerCase()) {
    if (ch === '-' || ch === '_') { if (tagli[tagli.length - 1] !== testo.length) tagli.push(testo.length); continue; }
    const m = CONFONDIBILI.get(ch);
    if (m !== undefined) {
      if (ch.charCodeAt(0) >= 0x80) straniere = true;
      else if (m !== ch) cifre = true;
      testo += m;
    } else if (/[a-z0-9]/.test(ch)) testo += ch;
    else if (ch.charCodeAt(0) >= 0x80) { straniere = true; testo += ch; }
  }
  if (tagli[tagli.length - 1] !== testo.length) tagli.push(testo.length);
  return { testo, tagli, straniere, cifre };
}

// Distanza di Damerau-Levenshtein ristretta (lo scambio di due vicine vale uno: amzaon è a uno da amazon).
function distanza(a, b) {
  const al = a.length, bl = b.length;
  if (!al || !bl) return al || bl;
  let p2 = null;
  let p = Array.from({ length: bl + 1 }, (_, j) => j);
  for (let i = 1; i <= al; i++) {
    const c = new Array(bl + 1);
    c[0] = i;
    for (let j = 1; j <= bl; j++) {
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v;
    }
    p2 = p; p = c;
  }
  return p[bl];
}

// Il marchio con al più `max` errori dentro un pezzo qualunque di `s` (Sellers): { d, inizio, fine } o null.
function dentroConErrori(s, t, max) {
  const n = s.length, m = t.length;
  if (n < m - max) return null;
  let p2 = null;
  let p = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const c = new Array(n + 1);
    c[0] = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (t[i - 1] === s[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && t[i - 1] === s[j - 2] && t[i - 2] === s[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v;
    }
    p2 = p; p = c;
  }
  let d = Infinity, fine = -1;
  for (let j = 0; j <= n; j++) if (p[j] < d) { d = p[j]; fine = j; }
  if (d > max) return null;
  // L'inizio: il pezzo che finisce lì con la distanza più bassa, a parità il più lungo come il marchio.
  let inizio = Math.max(0, fine - m);
  let best = Infinity;
  for (let k = Math.max(0, fine - m - max); k <= Math.min(fine, fine - m + max); k++) {
    const dk = distanza(s.slice(k, fine), t);
    if (dk < best || (dk === best && Math.abs(fine - k - m) < Math.abs(fine - inizio - m))) { best = dk; inizio = k; }
  }
  return { d, inizio, fine };
}

// Le etichette del nome divise per zona: il nome del sito (sld), quelle davanti (sotto) e le parole prima della
// chiocciola (esca), che a schermo aprono l'indirizzo ma il browser scarta.
function zoneDi(norm, esca) {
  const host = norm.hostUnicode || norm.host || '';
  const reg = norm.registrableUnicode || norm.registrable || '';
  const etichette = host.split('.').filter(Boolean);
  const n = reg ? reg.split('.').length : 1;
  const sotto = etichette.slice(0, Math.max(0, etichette.length - n)).filter((e) => !/^www\d*$/.test(e));
  const zone = [];
  const sld = norm.sldUnicode || norm.sld || '';
  if (sld) zone.push({ zona: 'sld', etichetta: sld });
  for (const e of sotto) zone.push({ zona: 'sotto', etichetta: e });
  for (const e of (esca || [])) if (e) zone.push({ zona: 'esca', etichetta: String(e).toLowerCase() });
  return zone;
}

// Ogni marchio che il nome può portare addosso, intero, travestito o con qualche lettera sbagliata.
function candidati(zone) {
  const out = [];
  for (const z of zone) {
    const sk = scheletroDi(z.etichetta);
    if (!sk.testo) continue;
    const letture = [{ testo: sk.testo, vista: false }];
    const vista = sk.testo.replace(/rn/g, 'm').replace(/vv/g, 'w');
    if (vista !== sk.testo) letture.push({ testo: vista, vista: true });
    for (const mc of MARCHI) {
      const t = mc.token;
      for (const l of letture) {
        const r = dentroConErrori(l.testo, t, mc.soglia);
        if (!r) continue;
        const intero = r.inizio === 0 && r.fine === l.testo.length;
        let tipo;
        if (r.d === 0 && intero) tipo = (sk.straniere ? 'omografo' : (sk.cifre || l.vista) ? 'sosia' : 'esatto');
        else if (r.d === 0) tipo = (sk.straniere ? 'omografo' : (sk.cifre || l.vista) ? 'sosiadentro' : 'dentro');
        else if (Math.abs(l.testo.length - t.length) <= mc.soglia && distanza(l.testo, t) <= mc.soglia) tipo = 'typo';
        else tipo = 'typodentro';
        // Le letture di una stessa etichetta danno lo stesso candidato: tiene la prima che lo trova.
        if (out.some((c) => c.mc === mc && c.etichetta === z.etichetta && c.zona === z.zona)) continue;
        out.push({ mc, zona: z.zona, etichetta: z.etichetta, tipo, d: r.d, inizio: r.inizio, fine: r.fine, sk: { ...sk, testo: l.testo }, vista: l.vista });
        break;
      }
    }
  }
  return out;
}

function fascia(n, limiti) {
  let i = 0;
  while (i < limiti.length && n > limiti[i]) i++;
  return i;
}

// Le caratteristiche di un candidato, come stringhe: il modello ne conosce il peso per impronta.
function caratteristiche(c, zone, info) {
  const f = [];
  const k = c.tipo;
  const t = c.mc.token;
  const testo = c.sk.testo;
  const sx = testo.slice(0, c.inizio);
  const dx = testo.slice(c.fine);
  const resto = sx + dx;
  const suff = info.suffisso || '';
  const tld = suff.slice(suff.lastIndexOf('.') + 1);
  const pezzoInizio = c.sk.tagli.includes(c.inizio);
  const pezzoFine = c.sk.tagli.includes(c.fine);
  const pezzo = (pezzoInizio ? 'i' : '') + (pezzoFine ? 'f' : '');
  const lun = fascia(t.length, [4, 5, 6, 7, 9]);
  f.push('k=' + k, 'z=' + c.zona, 'kz=' + k + c.zona, 'ko=' + k + (info.ospitato ? 1 : 0), 'zo=' + c.zona + (info.ospitato ? 1 : 0));
  f.push('b=' + t, 'bk=' + t + '|' + k, 'bz=' + t + '|' + c.zona);
  f.push('l=' + lun + k, 'd=' + c.d + k + lun, 'pz=' + pezzo + k, 'pzz=' + pezzo + c.zona);
  f.push('pa=' + (c.mc.parola ? 1 : 0) + k, 'pal=' + (c.mc.parola ? 1 : 0) + lun + pezzo);
  f.push('tld=' + tld, 'ps=' + suff, 'kt=' + k + '|' + tld, 'kps=' + k + '|' + suff, 'bt=' + t + '|' + tld);
  const truffa = !!resto && soloTruffa(sx) && soloTruffa(dx);
  f.push('tr=' + (resto ? (truffa ? 1 : 0) : 'v') + k, 'trl=' + (truffa ? 1 : 0) + lun + (c.mc.parola ? 1 : 0));
  if (c.vista) f.push('vista');
  f.push('rl=' + fascia(resto.length, [0, 2, 4, 6, 9, 13, 20]) + k);
  f.push('nh=' + Math.min(4, c.sk.tagli.length - 2) + c.zona);
  f.push('nd=' + fascia((testo.match(/[0-9]/g) || []).length, [0, 1, 3]));
  f.push('ns=' + Math.min(4, info.nSotto) + c.zona);
  // Il contesto del marchio: quello che gli sta intorno, con i bordi, a pezzi di tre e quattro lettere.
  const marcato = '^' + sx + '#' + dx + '$';
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= marcato.length; i++) f.push('g' + n + '=' + marcato.slice(i, i + n));
  if (resto.length <= 16) f.push('r=' + marcato, 'rb=' + t + '|' + marcato);
  f.push('sx=' + sx.slice(-5), 'dx=' + dx.slice(0, 5));
  // Le altre etichette del nome, a pezzi di tre lettere: chi comanda davvero e cosa c'è davanti.
  for (const z of zone) {
    if (z.etichetta === c.etichetta && z.zona === c.zona) continue;
    const s = '^' + scheletroDi(z.etichetta).testo + '$';
    for (let i = 0; i + 3 <= s.length; i++) f.push('a' + z.zona[0] + '=' + s.slice(i, i + 3));
  }
  return f;
}

// FNV-1a a 32 bit: l'impronta che dice dove sta il peso di una caratteristica, e col bit alto il suo segno.
function impronta(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let modello = null;
function caricaModello() {
  if (modello) return modello;
  const buf = fs.readFileSync(FILE_MODELLO);
  const lungTesta = buf.readUInt32LE(4);
  const testa = JSON.parse(buf.toString('utf8', 8, 8 + lungTesta));
  const inizio = 8 + lungTesta;
  const pesi = new Int8Array(buf.buffer.slice(buf.byteOffset + inizio, buf.byteOffset + inizio + (1 << testa.bit)));
  modello = { ...testa, pesi, maschera: (1 << testa.bit) - 1 };
  return modello;
}

function punteggio(feats, m) {
  let s = m.bias;
  for (const x of feats) {
    const h = impronta(x);
    s += ((h & 0x80000000) ? -1 : 1) * m.pesi[h & m.maschera] * m.scala;
  }
  return 1 / (1 + Math.exp(-s));
}

function infoDi(norm, zone) {
  return {
    suffisso: norm.publicSuffix || '',
    ospitato: !!norm.ospitato,
    nSotto: zone.filter((z) => z.zona === 'sotto').length,
  };
}

// Tutti i candidati del nome con le loro caratteristiche: lo script di addestramento parte da qui.
function esempi(norm, esca) {
  if (!norm || !norm.ok || norm.isIp || norm.single || norm.suffixOnly) return [];
  if (LEGIT_DOMAINS.has(norm.registrable)) return [];
  const zone = zoneDi(norm, esca);
  const info = infoDi(norm, zone);
  return candidati(zone).map((c) => ({ c, feats: caratteristiche(c, zone, info) }));
}

const TIPO_VERDETTO = { omografo: 'omografo', sosia: 'sosia', sosiadentro: 'sosia', typo: 'typo', typodentro: 'typo', esatto: 'nome', dentro: 'nome' };

// Il verdetto sul nome: null, o il marchio imitato con { tipo: 'omografo'|'sosia'|'typo'|'nome', zona, punteggio,
// forte }. `forte`: travestimento o refuso a una lettera di un marchio lungo, che da solo basta per «Pericoloso».
function giudica(norm, { esca } = {}) {
  const lista = esempi(norm, esca);
  if (!lista.length) return null;
  const m = caricaModello();
  let meglio = null;
  for (const { c, feats } of lista) {
    const p = punteggio(feats, m);
    if (!meglio || p > meglio.punteggio) meglio = { c, punteggio: p };
  }
  if (meglio.punteggio < m.soglia) return null;
  const { c } = meglio;
  const tipo = TIPO_VERDETTO[c.tipo];
  const travestito = tipo === 'omografo' || tipo === 'sosia';
  const refusoForte = c.tipo === 'typo' && c.mc.token.length >= 8 && c.d === 1;
  return {
    brand: c.mc.brand,
    tipo,
    zona: c.zona,
    nome: c.etichetta,
    distanza: c.d,
    punteggio: meglio.punteggio,
    forte: (travestito || refusoForte) && meglio.punteggio >= m.sogliaForte,
  };
}

module.exports = { giudica, esempi, impronta, distanza, dentroConErrori, scheletroDi, FILE_MODELLO };
