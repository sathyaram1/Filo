// Imitazioni di un marchio nel nome di un sito: i candidati dall'elenco dei marchi (brands.js), il verdetto da un
// classificatore sulle lettere, locale e sincrono, uno solo per apertura e menu. Qui si decide dove un marchio può stare,
// mai il verdetto: un falso allarme si cura con un esempio in scripts/imitazioni/etichette.tsv e rigenerando il modello.

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
  // Come il marchio si legge a schermo: office365 lì è officee6s, come ogni etichetta che lo porta.
  lettura: scheletroDi(b.token).testo,
  soglia: tolleranza(b.token.length),
  parola: MARCHI_PAROLA.has(b.token),
  forme: (MARCHI_PAROLA.get(b.token) || []).filter((x) => x !== b.token),
  omonimi: new Set(b.omonimi || []),
  suffissi: b.domains.filter((d) => d.startsWith(b.token + '.')).map((d) => d.slice(b.token.length + 1)),
}));

// Un'etichetta letta come a schermo (confusables.js), a pezzi fra i trattini. Per ogni lettera: `testo` è come si
// legge, `crudo` tiene le cifre (2024 resta 2024 attorno al marchio), `mut` dice se la lettera vera era un'altra
// (1 una cifra o rn/vv, 2 una lettera di un altro alfabeto).
function scheletroDi(etichetta) {
  const pezzi = [];
  let cur = null;
  let straniere = false;
  for (const ch of etichetta.normalize('NFC').toLowerCase()) {
    if (ch === '-' || ch === '_') { cur = null; continue; }
    if (!cur) { cur = { testo: [], crudo: [], mut: [] }; pezzi.push(cur); }
    const m = CONFONDIBILI.get(ch);
    const fuori = ch.charCodeAt(0) >= 0x80;
    if (fuori) straniere = true;
    if (m !== undefined) {
      cur.testo.push(m);
      cur.crudo.push(fuori ? m : ch);
      cur.mut.push(m === ch ? 0 : fuori ? 2 : 1);
    } else if (/[a-z0-9]/.test(ch) || fuori) {
      cur.testo.push(ch); cur.crudo.push(ch); cur.mut.push(0);
    }
  }
  const buoni = pezzi.filter((p) => p.testo.length);
  return { ...unisci(buoni), pezzi: buoni, straniere };
}

// rn e vv a schermo sono m e w (rnicrosoft, vvhatsapp): una lettera sola, presa per travestita.
function vista(p) {
  const out = { testo: [], crudo: [], mut: [] };
  for (let i = 0; i < p.testo.length; i++) {
    const due = p.testo[i] + (p.testo[i + 1] || '');
    if (due === 'rn' || due === 'vv') {
      const l = due === 'rn' ? 'm' : 'w';
      out.testo.push(l); out.crudo.push(l); out.mut.push(Math.max(1, p.mut[i], p.mut[i + 1]));
      i++;
    } else { out.testo.push(p.testo[i]); out.crudo.push(p.crudo[i]); out.mut.push(p.mut[i]); }
  }
  return out;
}

function unisci(pezzi) {
  const tagli = [0];
  for (const p of pezzi) tagli.push(tagli[tagli.length - 1] + p.testo.length);
  return {
    testo: pezzi.map((p) => p.testo.join('')).join(''),
    crudo: pezzi.map((p) => p.crudo.join('')).join(''),
    mut: pezzi.flatMap((p) => p.mut),
    tagli,
  };
}

// Le coppie di lettere che a schermo si scambiano: un refuso fra queste è un travestimento (lcloud, appie, gooqle).
const SOMIGLIANTI = new Set(['il', 'li', 'lj', 'jl', 'ij', 'ji', 'iy', 'yi', 'vw', 'wv', 'uv', 'vu', 'mn', 'nm', 'gq', 'qg', 'ao', 'oa', 'ce', 'ec', 'rn', 'nr']);
function scambioSimile(a, b) {
  if (a.length !== b.length) return false;
  let diversi = 0, simile = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diversi++;
    simile = SOMIGLIANTI.has(a[i] + b[i]);
  }
  return diversi === 1 && simile;
}

// Il pezzo fra i trattini che contiene la lettera `i` alterna lettere e cifre come un nome generato (dh19lk58).
function pezzoGenerato(l, i) {
  let k = 0;
  while (k + 1 < l.tagli.length - 1 && l.tagli[k + 1] <= i) k++;
  return (l.crudo.slice(l.tagli[k], l.tagli[k + 1]).match(/(?=[a-z][0-9]|[0-9][a-z])/g) || []).length >= 3;
}

// Che errore separa a una lettera il pezzo dal marchio: la lettera raddoppiata (gooogle) e quella saltata da una
// doppia (faceboook, facebok) sono i refusi di chi imita; le altre sono più spesso un'altra parola.
function tipoErrore(p, t) {
  if (p.length === t.length + 1) {
    for (let i = 0; i < p.length; i++) {
      if (p.slice(0, i) + p.slice(i + 1) === t) return (p[i] === p[i - 1] || p[i] === p[i + 1]) ? 'doppia' : 'aggiunta';
    }
  } else if (p.length === t.length - 1) {
    for (let i = 0; i < t.length; i++) {
      if (t.slice(0, i) + t.slice(i + 1) === p) return (t[i] === t[i - 1] || t[i] === t[i + 1]) ? 'scempia' : 'tolta';
    }
  } else if (p.length === t.length) {
    for (let i = 0; i + 1 < p.length; i++) {
      if (p[i] !== t[i]) return p[i] === t[i + 1] && p[i + 1] === t[i] ? 'scambio' : 'cambiata';
    }
    return 'cambiata';
  }
  return 'altro';
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
  if (!max) { const i = s.indexOf(t); return i < 0 ? null : { d: 0, inizio: i, fine: i + m }; }
  // Con `max` errori almeno uno di 2·max+1 pezzi del marchio resta intero (uno scambio di vicine ne rompe due).
  let intatto = false;
  for (let k = 0, parti = 2 * max + 1; k < parti && !intatto; k++) {
    const a = Math.floor((k * m) / parti), b = Math.floor(((k + 1) * m) / parti);
    intatto = b > a && s.includes(t.slice(a, b));
  }
  if (!intatto) return null;
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

const ESCA_MAX = 8;

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
  // `segue`: l'etichetta subito dopo, che in paypal.com.altro.net è il finto dominio di primo livello.
  if (sld) zone.push({ zona: 'sld', etichetta: sld, segue: '' });
  sotto.forEach((e, i) => zone.push({ zona: 'sotto', etichetta: e, segue: i + 1 < sotto.length ? sotto[i + 1] : sld }));
  // Davanti alla chiocciola si scrive quello che si vuole e quanto si vuole: bastano le prime parole, come a schermo.
  const parole = (esca || []).slice(0, ESCA_MAX).map((e) => String(e || '').toLowerCase().slice(0, 63)).filter(Boolean);
  parole.forEach((e, i) => zone.push({ zona: 'esca', etichetta: e, segue: parole[i + 1] || '' }));
  return zone;
}

// Ogni marchio che il nome può portare addosso, intero, travestito o con qualche lettera sbagliata.
function candidati(zone, registrable) {
  const out = [];
  for (const z of zone) {
    const sk = scheletroDi(z.etichetta);
    if (!sk.testo) continue;
    const letture = [{ ...sk, vista: false }];
    const v = unisci(sk.pezzi.map(vista));
    if (v.testo !== sk.testo) letture.push({ ...v, vista: true });
    for (const mc of MARCHI) {
      if (mc.omonimi.has(registrable)) continue;
      const t = mc.lettura;
      // Fra le due letture vale quella più vicina al marchio: rnicrosoft a occhio è microsoft, non un refuso.
      let meglio = null;
      for (const l of letture) {
        const r = dentroConErrori(l.testo, t, mc.soglia);
        if (r && (!meglio || r.d < meglio.r.d)) meglio = { r, l };
      }
      if (!meglio) continue;
      const { r, l } = meglio;
      // Un marchio corto, o storpiato, in un nome generato (x72qhcrn02dh18, 1eyaho3e: i nomi che cloud e anteprime danno
      // da soli, lettere e cifre che si alternano) ci è caduto per caso: nessuno lo legge lì.
      if ((t.length <= 4 || r.d > 0) && pezzoGenerato(l, r.inizio)) continue;
      let tipo;
      let d = r.d;
      let [inizio, fine] = [r.inizio, r.fine];
      if (r.d > 0) {
        const tutto = Math.abs(l.testo.length - t.length) <= mc.soglia ? distanza(l.testo, t) : Infinity;
        if (tutto <= mc.soglia) { tipo = 'typo'; d = tutto; [inizio, fine] = [0, l.testo.length]; } else tipo = 'typodentro';
      }
      // Il travestimento conta solo dentro il marchio (in facebook-form23 le cifre sono altrove), e una cifra che il
      // marchio ha davvero non lo traveste (office365).
      let mut = 0;
      for (let i = inizio; i < fine; i++) {
        const cifraSua = /[0-9]/.test(l.crudo[i]) && (r.d === 0 ? mc.token[i - inizio] === l.crudo[i] : mc.token.includes(l.crudo[i]));
        if (!cifraSua) mut = Math.max(mut, l.mut[i]);
      }
      if (!tipo) {
        const intero = inizio === 0 && fine === l.testo.length;
        tipo = (mut === 2 ? 'omografo' : mut === 1 ? 'sosia' : 'esatto') + (intero ? '' : 'dentro');
      }
      const simile = d === 1 && scambioSimile(l.testo.slice(inizio, fine), t);
      const errore = d === 1 ? tipoErrore(l.testo.slice(inizio, fine), t) : '';
      out.push({ mc, zona: z.zona, etichetta: z.etichetta, segue: z.segue, tipo, d, mut, simile, errore, inizio, fine, sk: l, straniere: sk.straniere });
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
  const { testo, crudo } = c.sk;
  const sx = testo.slice(0, c.inizio);
  const dx = testo.slice(c.fine);
  const resto = sx + dx;
  const suff = info.suffisso || '';
  const tld = suff.slice(suff.lastIndexOf('.') + 1);
  const pezzo = (c.sk.tagli.includes(c.inizio) ? 'i' : '') + (c.sk.tagli.includes(c.fine) ? 'f' : '');
  const lun = fascia(t.length, [4, 5, 6, 7, 9]);
  const parola = c.mc.parola ? 1 : 0;
  f.push('k=' + k, 'z=' + c.zona, 'kz=' + k + c.zona, 'ko=' + k + (info.ospitato ? 1 : 0), 'zo=' + c.zona + (info.ospitato ? 1 : 0));
  f.push('b=' + t, 'bk=' + t + '|' + k, 'bz=' + t + '|' + c.zona);
  f.push('l=' + lun + k, 'd=' + c.d + k + lun, 'm=' + c.mut + k, 'pz=' + pezzo + k, 'pzz=' + pezzo + c.zona);
  f.push('pa=' + parola + k, 'pal=' + parola + lun + pezzo);
  f.push('tld=' + tld, 'ps=' + suff, 'kt=' + k + '|' + tld, 'kps=' + k + '|' + suff, 'bt=' + t + '|' + tld);
  // Un suffisso di paese è spesso del marchio stesso (ebay.in), uno generico quasi mai (amazon.online): anche per i
  // suffissi che fra gli esempi non ci sono.
  const generico = tld.length > 2 && !['com', 'net', 'org', 'edu', 'gov'].includes(tld) ? 'g' : tld.length > 2 ? 'v' : 'p';
  f.push('tg=' + generico + k + c.zona + (info.ospitato ? 1 : 0), 'tgp=' + generico + parola + k);
  const truffa = !!resto && soloTruffa(sx) && soloTruffa(dx);
  f.push('tr=' + (resto ? (truffa ? 1 : 0) : 'v') + k, 'trl=' + (truffa ? 1 : 0) + lun + parola);
  // Il marchio insieme al resto da truffa: imposte e proposte insegnano che «poste» dentro una parola è innocuo, e da
  // solo quel peso spegneva anche posteonline e poste-sicurezza.
  f.push('btr=' + t + '|' + (resto ? (truffa ? 1 : 0) : 'v'));
  if (c.straniere) f.push('st=' + k);
  if (c.simile) f.push('si=' + k, 'sil=' + k + lun);
  if (c.errore) f.push('er=' + c.errore + k, 'erl=' + c.errore + lun);
  // Lo stesso suffisso di un indirizzo vero del marchio (gooogle.com accanto a google.com): l'errore di chi digita.
  if (c.zona === 'sld' && c.mc.brand.domains.includes(t + '.' + suff)) f.push('uf=' + k + c.d);
  // Il nome giusto con un refuso nel suffisso (github.co per github.com).
  if (k === 'esatto' && c.zona === 'sld' && !c.mc.suffissi.includes(suff) && c.mc.suffissi.some((x) => distanza(x, suff) === 1)) f.push('ut=' + k);
  f.push('rl=' + fascia(resto.length, [0, 2, 4, 6, 9, 13, 20]) + k);
  f.push('nh=' + Math.min(4, c.sk.tagli.length - 2) + c.zona);
  f.push('nd=' + fascia((crudo.match(/[0-9]/g) || []).length, [0, 1, 3, 6]));
  f.push('ns=' + Math.min(4, info.nSotto) + c.zona);
  if (c.segue) f.push('sg=' + (c.segue.length <= 4 ? c.segue : '*'), 'sgk=' + k + (c.segue.length <= 3 ? 'corta' : 'lunga'));
  if (c.mc.forme.some((x) => testo.includes(x))) f.push('fo=' + k);
  if (c.sk.tagli.some((x) => x > c.inizio && x < c.fine)) f.push('sp=' + k);
  // Il contesto del marchio: quello che gli sta intorno, com'è scritto, coi bordi e i trattini, a pezzi di due, tre e
  // quattro lettere.
  const marcato = '^' + conTrattini(c.sk, 0, c.inizio) + '#' + conTrattini(c.sk, c.fine, testo.length) + '$';
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= marcato.length; i++) f.push('g' + n + '=' + marcato.slice(i, i + n));
  if (resto.length <= 16) f.push('r=' + marcato, 'rb=' + t + '|' + marcato);
  f.push('sx=' + sx.slice(-5), 'dx=' + dx.slice(0, 5));
  // Le altre etichette del nome, a pezzi di tre lettere: chi comanda davvero e cosa c'è davanti.
  for (const z of zone) {
    if (z.etichetta === c.etichetta && z.zona === c.zona) continue;
    const s = '^' + scheletroDi(z.etichetta).crudo + '$';
    for (let i = 0; i + 3 <= s.length; i++) f.push('a' + z.zona[0] + '=' + s.slice(i, i + 3));
  }
  return f;
}

// Il pezzo [da, a) com'è scritto, coi trattini dove l'etichetta li aveva, compresi quelli che lo toccano.
function conTrattini(sk, da, a) {
  let out = '';
  for (let i = da; i < a; i++) {
    if (i > 0 && sk.tagli.includes(i)) out += '-';
    out += sk.crudo[i];
  }
  if (a > da && a < sk.testo.length && sk.tagli.includes(a)) out += '-';
  return out;
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
  let buf;
  // Senza modello il controllo tace sui marchi invece di far cadere tutto il verdetto; lo dice una volta, nel log.
  try { buf = fs.readFileSync(FILE_MODELLO); } catch (e) {
    console.error('[safebrowse] modello delle imitazioni illeggibile:', e.message);
    modello = { bias: -Infinity, scala: 0, pesi: new Int8Array(1), maschera: 0, soglia: 1, sogliaForte: 1 };
    return modello;
  }
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

// Le parole prima della «@» (https://paypal.com@altro.net, anche scritta %40 o con la password): a schermo aprono
// l'indirizzo, ma il browser le scarta e va dopo la chiocciola.
function escaDi(url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return []; }
  let s = u.username + (u.password ? '.' + u.password : '');
  try { s = decodeURIComponent(s); } catch (_) {}
  return s.toLowerCase().split(/[.:/@%]/).filter(Boolean);
}

// Tutti i candidati del nome con le loro caratteristiche: lo script di addestramento parte da qui. Su un indirizzo
// IP contano solo le parole prima della chiocciola.
function esempi(norm, esca) {
  if (!norm || !norm.ok || norm.single || norm.suffixOnly) return [];
  if (LEGIT_DOMAINS.has(norm.registrable)) return [];
  if (norm.isIp && !(esca && esca.length)) return [];
  const zone = norm.isIp ? zoneDi({}, esca) : zoneDi(norm, esca);
  const info = infoDi(norm, zone);
  return candidati(zone, norm.registrable).map((c) => ({ c, feats: caratteristiche(c, zone, info) }));
}

const TIPO_VERDETTO = {
  omografo: 'omografo', omografodentro: 'omografo', sosia: 'sosia', sosiadentro: 'sosia', typo: 'typo', typodentro: 'typo',
  esatto: 'nome', esattodentro: 'nome',
};

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
    segue: c.segue,
    distanza: c.d,
    punteggio: meglio.punteggio,
    forte: (travestito || refusoForte) && meglio.punteggio >= m.sogliaForte,
  };
}

// Le funzioni da cui dipende chi porta un marchio: lo script di addestramento ne tiene i risultati finché non cambiano.
const FIRMA_CANDIDATI = [tolleranza, scheletroDi, vista, unisci, dentroConErrori, pezzoGenerato, zoneDi, candidati, esempi].map(String).join('\n');

module.exports = { giudica, esempi, escaDi, impronta, distanza, dentroConErrori, scheletroDi, FILE_MODELLO, FIRMA_CANDIDATI };
