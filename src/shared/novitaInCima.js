// Le righe che un ramo ha aggiunto al registro delle novità sotto versioni già uscite, riportate nel blocco della
// prossima versione (#2057, #2214). PURA e senza eseguire il registro: il server la incorpora al deploy (filo-security
// tools/bake-shared.js) e la applica a rami scritti da altri. Prove: tests/unit/novitaInCima.test.mjs.

(function (global) {
  'use strict';

  const FILE_NOVITA = 'src/shared/patchNotes.js';
  const CAMPO = 'prossimaVersione';
  // Gli esiti degli unit, girati con le righe già spostate, dopo i quali lo spostamento da solo rende fondibile il ramo:
  // li legge la prova sulla fusione dell'app e li legge il server che decide se spostare.
  const BASTA_SPOSTARE = Object.freeze(['verde', 'rosso_anche_su_main']);
  const A_B_C = /^\d+\.\d+\.\d+$/;
  const CHIAVI = ['features', 'fixes'];
  // Il registro vero pesa qualche centinaio di KB: oltre è un file che non è il registro.
  const TETTO_SORGENTE = 16 * 1024 * 1024;
  const TETTO_PROFONDITA = 32;

  // Stesse regole di cmpVersion e testo di patchNotes.js, che il server non carica: la sentinella le confronta.
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  function testo(r) {
    return r && typeof r === 'object' ? String(r.testo || '') : String(r == null ? '' : r);
  }

  /** La prossima versione con la regola del server che la pubblica: `prossimaVersione` di primo livello, o patch+1. `{ versione, dichiarata }` | `{ errore }`. */
  function prossimaVersione(manifesto) {
    const attuale = String((manifesto && manifesto.version) || '');
    if (!A_B_C.test(attuale)) return { errore: `la versione del manifesto «${attuale}» non è nella forma a.b.c` };
    if (!Object.prototype.hasOwnProperty.call(manifesto, CAMPO)) {
      const [a, b, c] = attuale.split('.').map(Number);
      return { versione: `${a}.${b}.${c + 1}`, dichiarata: false };
    }
    const dichiarata = manifesto[CAMPO];
    if (typeof dichiarata !== 'string' || !A_B_C.test(dichiarata)) {
      return { errore: `«${CAMPO}» nel manifesto vale ${JSON.stringify(dichiarata)}: serve un numero a.b.c, come "0.3.0". `
        + 'Il server rifiuterebbe la pubblicazione: correggilo o toglilo.' };
    }
    if (cmpVersion(dichiarata, attuale) <= 0) {
      return { errore: `«${CAMPO}» nel manifesto è ${dichiarata}, non più alta della versione ${attuale}. `
        + 'Il server rifiuterebbe la pubblicazione: alzalo o toglilo.' };
    }
    return { versione: dichiarata, dichiarata: true };
  }

  // ── Lettura del sorgente: dove comincia e finisce ogni elemento, senza un parser fuori dal repo ──

  function dopoStringa(src, i) {
    const q = src[i];
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = elementi(src, j + 1).chiude; continue; }
      if (src[j] === q) return j + 1;
      if (q !== '`' && src[j] === '\n') break;
    }
    throw new Error(`stringa non chiusa al carattere ${i}`);
  }

  function dopoCommento(src, i) {
    if (src[i] !== '/') return i;
    if (src[i + 1] === '/') { const a = src.indexOf('\n', i); return a < 0 ? src.length : a; }
    if (src[i + 1] === '*') { const a = src.indexOf('*/', i + 2); if (a < 0) throw new Error('commento non chiuso'); return a + 2; }
    return i;
  }

  const APRE = { '[': ']', '{': '}', '(': ')' };

  /** `src[apre]` è [ { o (: dove si chiude e i suoi elementi di primo livello, `{ inizio, fine }` senza spazi né commenti attorno. */
  function elementi(src, apre) {
    const pila = [APRE[src[apre]]];
    const out = [];
    let inizio = -1;
    let fine = -1;
    let i = apre + 1;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      const dc = dopoCommento(src, i);
      if (dc !== i) { i = dc; continue; }
      if (pila.length === 1 && (c === ',' || c === pila[0])) {
        if (inizio >= 0) out.push({ inizio, fine });
        inizio = -1;
        if (c === pila[0]) return { chiude: i, elementi: out };
        i++;
        continue;
      }
      if (inizio < 0) inizio = i;
      if (c === '\'' || c === '"' || c === '`') { i = dopoStringa(src, i); fine = i; continue; }
      if (APRE[c]) pila.push(APRE[c]);
      else if (c === pila[pila.length - 1]) pila.pop();
      else if (c === ']' || c === '}' || c === ')') throw new Error(`«${c}» inatteso al carattere ${i}`);
      i++;
      fine = i;
    }
    throw new Error('parentesi non chiusa');
  }

  /** Dove apre l'elenco `const NOTES = [`. Lancia se non c'è. */
  function apreNotes(src) {
    const m = /\bconst\s+NOTES\s*=\s*\[/.exec(src);
    if (!m) throw new Error('non trovo «const NOTES = [»');
    return m.index + m[0].length - 1;
  }

  // ── Il registro letto come dati: solo letterali, mai eseguito (il server lo legge da rami scritti da altri) ──

  function saltaVuoto(src, i) {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      const dc = dopoCommento(src, i);
      if (dc === i) return i;
      i = dc;
    }
  }

  const ESCAPE = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

  /** Una stringa letterale che comincia in `src[i]` → { valore, fine }. Un template con `${` è codice: lancia. */
  function stringaLetterale(src, i) {
    const q = src[i];
    let out = '';
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === q) return { valore: out, fine: j + 1 };
      if (q === '`' && c === '$' && src[j + 1] === '{') throw new Error(`al carattere ${j} un template calcola un valore: non è un dato`);
      if (q !== '`' && (c === '\n' || c === '\r')) break;
      if (c === '\r' && q === '`') { out += '\n'; if (src[j + 1] === '\n') j++; continue; }
      if (c !== '\\') { out += c; continue; }
      const e = src[++j];
      if (e === undefined) break;
      if (e === '\r') { if (src[j + 1] === '\n') j++; continue; }
      if (e === '\n' || e === ' ' || e === ' ') continue;
      if (e === '0' && /[0-9]/.test(src[j + 1] || '')) throw new Error(`al carattere ${j} un escape ottale: non lo leggo`);
      if (Object.prototype.hasOwnProperty.call(ESCAPE, e)) { out += ESCAPE[e]; continue; }
      if (e === 'x') {
        const h = /^[0-9a-fA-F]{2}/.exec(src.slice(j + 1, j + 3));
        if (!h) throw new Error(`al carattere ${j} un escape \\x non valido`);
        out += String.fromCharCode(parseInt(h[0], 16));
        j += 2;
        continue;
      }
      if (e === 'u') {
        const graffa = /^\{([0-9a-fA-F]{1,6})\}/.exec(src.slice(j + 1, j + 10));
        const quattro = /^[0-9a-fA-F]{4}/.exec(src.slice(j + 1, j + 5));
        if (graffa && parseInt(graffa[1], 16) <= 0x10ffff) { out += String.fromCodePoint(parseInt(graffa[1], 16)); j += graffa[0].length; continue; }
        if (quattro) { out += String.fromCharCode(parseInt(quattro[0], 16)); j += 4; continue; }
        throw new Error(`al carattere ${j} un escape \\u non valido`);
      }
      if (/[1-9]/.test(e)) throw new Error(`al carattere ${j} un escape ottale: non lo leggo`);
      out += e;
    }
    throw new Error(`stringa non chiusa al carattere ${i}`);
  }

  /** Un valore letterale (stringa, numero, true/false/null, elenco, oggetto) da `src[i]` → { valore, fine }. Altro: lancia. */
  function valoreLetterale(src, i, profondita) {
    if (profondita > TETTO_PROFONDITA) throw new Error(`più di ${TETTO_PROFONDITA} livelli annidati: non è il registro`);
    i = saltaVuoto(src, i);
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') return stringaLetterale(src, i);
    if (c === '[') {
      const out = [];
      let j = saltaVuoto(src, i + 1);
      while (src[j] !== ']') {
        const v = valoreLetterale(src, j, profondita + 1);
        out.push(v.valore);
        j = saltaVuoto(src, v.fine);
        if (src[j] === ',') j = saltaVuoto(src, j + 1);
        else if (src[j] !== ']') throw new Error(`al carattere ${j} manca una virgola o la chiusura dell'elenco`);
      }
      return { valore: out, fine: j + 1 };
    }
    if (c === '{') {
      const out = {};
      let j = saltaVuoto(src, i + 1);
      while (src[j] !== '}') {
        let chiave;
        if (src[j] === '\'' || src[j] === '"') { const s = stringaLetterale(src, j); chiave = s.valore; j = s.fine; } else {
          const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(src.slice(j, j + 200));
          if (!m) throw new Error(`al carattere ${j} una chiave che non è un nome`);
          chiave = m[0];
          j += m[0].length;
        }
        if (chiave === '__proto__') throw new Error(`al carattere ${j} la chiave «__proto__»: non è un dato del registro`);
        j = saltaVuoto(src, j);
        if (src[j] !== ':') throw new Error(`al carattere ${j} manca «:» dopo «${chiave}»`);
        const v = valoreLetterale(src, j + 1, profondita + 1);
        out[chiave] = v.valore;
        j = saltaVuoto(src, v.fine);
        if (src[j] === ',') j = saltaVuoto(src, j + 1);
        else if (src[j] !== '}') throw new Error(`al carattere ${j} manca una virgola o la chiusura dell'oggetto`);
      }
      return { valore: out, fine: j + 1 };
    }
    const num = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (num) return { valore: Number(num[0]), fine: i + num[0].length };
    const parola = /^(?:true|false|null)\b/.exec(src.slice(i, i + 6));
    if (parola) return { valore: parola[0] === 'null' ? null : parola[0] === 'true', fine: i + parola[0].length };
    throw new Error(`al carattere ${i} c'è codice, non un dato`);
  }

  /** I blocchi del registro scritto in `src`, letti come dati senza eseguire niente. Lancia se il testo non è un registro. */
  function leggiRegistro(src) {
    const s = String(src);
    if (s.length > TETTO_SORGENTE) throw new Error(`il file pesa ${s.length} caratteri, oltre ${TETTO_SORGENTE}: non è il registro`);
    const notes = valoreLetterale(s, apreNotes(s), 0).valore;
    if (!Array.isArray(notes) || notes.some((n) => !n || typeof n !== 'object' || Array.isArray(n))) {
      throw new Error('«NOTES» non è un elenco di blocchi');
    }
    return notes;
  }

  const righe = (n) => CHIAVI.flatMap((chiave) => (n[chiave] || []).map((r, indice) => ({ chiave, indice, riga: testo(r) })));

  /**
   * Le righe che `dopo` aggiunge rispetto a `prima` sotto le versioni fino a `uscita` compresa, ognuna con blocco,
   * elenco e posto. Si contano le righe per blocco: riscrivere una riga già uscita, o spostarla nel blocco della
   * prossima versione, resta lecito.
   */
  function aggiunteSottoUscite(prima, dopo, uscita) {
    const vecchie = new Map(prima.map((n) => [n.version, righe(n).map((r) => r.riga)]));
    const out = [];
    for (const n of dopo) {
      if (cmpVersion(n.version, uscita) > 0) continue;
      const prec = vecchie.get(n.version) || [];
      const ora = righe(n);
      if (ora.length <= prec.length) continue;
      for (const r of ora) if (!prec.includes(r.riga)) out.push(Object.assign({ version: n.version }, r));
    }
    return out;
  }

  /**
   * Le righe che il ramo ha scritto sotto versioni uscite su main DOPO la sua partenza (#2130): sul ramo la sentinella è
   * verde, sulla fusione rossa, e si spostano solo dopo il rebase. `versioneMain`: la versione del manifesto di main.
   */
  function sottoUsciteSuMain(prima, dopo, manifesto, versioneMain) {
    const delRamo = String((manifesto && manifesto.version) || '');
    const suMain = String(versioneMain || '');
    if (!A_B_C.test(delRamo) || !A_B_C.test(suMain) || cmpVersion(suMain, delRamo) <= 0) return [];
    return aggiunteSottoUscite(prima, dopo, suMain).map(({ version, riga }) => ({ version, riga }));
  }

  const inizioRiga = (src, i) => src.lastIndexOf('\n', i - 1) + 1;
  const rientro = (src, i) => { const p = src.slice(inizioRiga(src, i), i); return /^[ \t]*$/.test(p) ? p : null; };

  /** Le proprietà di un oggetto letterale: nome, dove sta tutta e dove comincia il valore. */
  function proprieta(src, apre) {
    const { chiude, elementi: el } = elementi(src, apre);
    const props = el.map((e) => {
      const m = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*/.exec(src.slice(e.inizio, e.fine));
      return m ? Object.assign({ nome: m[1] }, e, { valore: e.inizio + m[0].length }) : Object.assign({ nome: '' }, e, { valore: -1 });
    });
    return { chiude, props };
  }

  /** La mappa del registro nel sorgente: per ogni blocco i suoi limiti e, per features e fixes, l'elenco e i suoi elementi. */
  function mappaSorgente(src) {
    const apre = apreNotes(src);
    const { chiude, elementi: blocchi } = elementi(src, apre);
    return {
      apre, chiude,
      blocchi: blocchi.map((b) => {
        if (src[b.inizio] !== '{') throw new Error(`un blocco del registro non è un oggetto (carattere ${b.inizio})`);
        const { chiude: fineOggetto, props } = proprieta(src, b.inizio);
        const elenchi = {};
        for (const p of props) {
          if (!CHIAVI.includes(p.nome)) continue;
          if (src[p.valore] !== '[') throw new Error(`«${p.nome}» non è un elenco scritto per esteso (carattere ${p.valore})`);
          const e = elementi(src, p.valore);
          elenchi[p.nome] = { prop: p, apre: p.valore, chiude: e.chiude, elementi: e.elementi };
        }
        return Object.assign({}, b, { chiudeOggetto: fineOggetto, props, elenchi });
      }),
    };
  }

  /** Il tratto da togliere per far sparire l'elemento `el` (di `tutti`): la sua riga intera se ce l'ha da solo. */
  function tagliaElemento(src, el, tutti) {
    const dopo = /^[ \t]*,?[ \t]*(\/\/[^\n]*)?\r?\n/.exec(src.slice(el.fine));
    if (rientro(src, el.inizio) !== null && dopo) return { da: inizioRiga(src, el.inizio), a: el.fine + dopo[0].length, testo: '' };
    const virgola = /^\s*,[ \t]*/.exec(src.slice(el.fine));
    if (virgola) return { da: el.inizio, a: el.fine + virgola[0].length, testo: '' };
    const k = tutti.indexOf(el);
    return { da: k > 0 ? tutti[k - 1].fine : el.inizio, a: el.fine, testo: '' };
  }

  /** Manca la virgola fra l'ultimo elemento (o proprietà) e la chiusura? Allora la si aggiunge. */
  function virgolaDopo(src, ultimo, chiude) {
    if (!ultimo) return null;
    let i = ultimo.fine;
    while (i < chiude) {
      const dc = dopoCommento(src, i);
      if (dc !== i) { i = dc; continue; }
      if (src[i] === ',') return null;
      i++;
    }
    return { da: ultimo.fine, a: ultimo.fine, testo: ',' };
  }

  function applica(src, modifiche) {
    const ord = modifiche.slice().sort((x, y) => y.da - x.da || y.a - x.a);
    for (let k = 1; k < ord.length; k++) {
      if (ord[k].a > ord[k - 1].da) throw new Error('due modifiche si sovrappongono: il registro va sistemato a mano');
    }
    let out = src;
    for (const m of ord) out = out.slice(0, m.da) + m.testo + out.slice(m.a);
    return out;
  }

  const json = (x) => JSON.stringify(x);

  /**
   * Sposta nel blocco della prossima versione le righe che il registro `src` ha in più di `prima` sotto versioni già
   * uscite per `manifesto`; il blocco si apre in cima se non c'è, con la data `oggi`.
   * → { ok: true, src, spostate: [{ version, chiave, riga }], verso } | { ok: false, motivo }
   */
  function spostaInCima(src, { prima, manifesto, oggi }) {
    let dopo;
    try { dopo = leggiRegistro(src); } catch (e) { return { ok: false, motivo: `il registro non si legge: ${e.message}` }; }
    const uscita = String((manifesto && manifesto.version) || '');
    const p = prossimaVersione(manifesto);
    if (p.errore) return { ok: false, motivo: p.errore };
    const sposta = aggiunteSottoUscite(prima, dopo, uscita);
    if (!sposta.length) return { ok: true, src, spostate: [], verso: p.versione };
    const versioni = dopo.map((n) => n.version);
    const doppia = versioni.find((v, k) => versioni.indexOf(v) !== k);
    if (doppia) return { ok: false, motivo: `il blocco ${doppia} compare due volte: sistemalo a mano, poi rilancia` };
    // Righe diverse da prima più di quelle in più: il ramo ne ha anche riscritta una già letta da chi ha quella versione,
    // e quale sia l'aggiunta non è meccanico. Spostarle tutte svuoterebbe un blocco uscito.
    for (const n of dopo) {
      const quante = sposta.filter((s) => s.version === n.version).length;
      const prec = prima.find((x) => x.version === n.version);
      if (quante > righe(n).length - (prec ? righe(prec).length : 0)) {
        return { ok: false, motivo: `nel blocco ${n.version}, già uscito, il ramo ha anche riscritto righe che c'erano: sposta a mano nel blocco ${p.versione} solo quelle aggiunte` };
      }
    }
    const sopra = dopo.filter((n) => cmpVersion(n.version, uscita) > 0);
    if (sopra.length > 1 || (sopra.length && (sopra[0] !== dopo[0] || sopra[0].version !== p.versione))) {
      return { ok: false, motivo: `sopra la versione ${uscita} ci sono i blocchi ${sopra.map((n) => n.version).join(', ')}: ne serve uno solo, ${p.versione}, in cima. Sistemalo a mano, poi rilancia` };
    }

    let mappa;
    try { mappa = mappaSorgente(src); } catch (e) { return { ok: false, motivo: `non riesco a leggere il registro: ${e.message}` }; }
    if (mappa.blocchi.length !== dopo.length) return { ok: false, motivo: 'il registro scritto e quello letto non hanno gli stessi blocchi' };
    for (let b = 0; b < dopo.length; b++) {
      for (const chiave of CHIAVI) {
        const n = (dopo[b][chiave] || []).length;
        const e = mappa.blocchi[b].elenchi[chiave];
        if ((e ? e.elementi.length : 0) !== n) return { ok: false, motivo: `nel blocco ${dopo[b].version} «${chiave}» scritto e letto non tornano` };
      }
    }

    // I dati attesi, prima del testo: il testo nuovo deve rileggersi esattamente in questi.
    const attesi = JSON.parse(json(dopo));
    const via = new Set(sposta.map((s) => `${s.version}\u0000${s.chiave}\u0000${s.indice}`));
    const daPortare = { features: [], fixes: [] };
    const modifiche = [];
    for (let b = 0; b < dopo.length; b++) {
      const n = dopo[b];
      const blocco = mappa.blocchi[b];
      const tutte = righe(n);
      const partono = tutte.filter((r) => via.has(`${n.version}\u0000${r.chiave}\u0000${r.indice}`));
      if (!partono.length) continue;
      for (const r of partono) daPortare[r.chiave].push(src.slice(blocco.elenchi[r.chiave].elementi[r.indice].inizio, blocco.elenchi[r.chiave].elementi[r.indice].fine));
      if (partono.length === tutte.length) {
        modifiche.push(tagliaElemento(src, blocco, mappa.blocchi));
        attesi[b] = null;
        continue;
      }
      for (const chiave of CHIAVI) {
        const e = blocco.elenchi[chiave];
        if (!e) continue;
        const qui = partono.filter((r) => r.chiave === chiave).map((r) => r.indice);
        if (!qui.length) continue;
        attesi[b][chiave] = attesi[b][chiave].filter((_, k) => !qui.includes(k));
        if (qui.length === e.elementi.length) { modifiche.push({ da: e.apre, a: e.chiude + 1, testo: '[]' }); continue; }
        for (const k of qui) modifiche.push(tagliaElemento(src, e.elementi[k], e.elementi));
      }
    }

    const testoDi = (r) => JSON.parse(json(r));
    const portate = (chiave) => sposta.filter((s) => s.chiave === chiave).map((s) => testoDi(dopo.find((n) => n.version === s.version)[chiave][s.indice]));
    const cima = sopra[0] ? mappa.blocchi[0] : null;
    if (cima) {
      const rProp = rientro(src, cima.props[0].inizio);
      const rChiude = rientro(src, cima.chiudeOggetto);
      if (rProp === null || rChiude === null) return { ok: false, motivo: `il blocco ${p.versione} non è scritto una proprietà per riga: aggiungi le righe a mano` };
      for (const chiave of CHIAVI) {
        if (!daPortare[chiave].length) continue;
        const e = cima.elenchi[chiave];
        attesi[0][chiave] = (attesi[0][chiave] || []).concat(portate(chiave));
        if (!e) {
          const ultima = cima.props[cima.props.length - 1];
          const v = virgolaDopo(src, ultima, cima.chiudeOggetto);
          if (v) modifiche.push(v);
          const corpo = daPortare[chiave].map((t) => `${rProp}  ${t},\n`).join('');
          modifiche.push({ da: inizioRiga(src, cima.chiudeOggetto), a: inizioRiga(src, cima.chiudeOggetto), testo: `${rProp}${chiave}: [\n${corpo}${rProp}],\n` });
          continue;
        }
        const rChiusa = rientro(src, e.chiude);
        if (rChiusa !== null && e.elementi.length) {
          const rEl = rientro(src, e.elementi[0].inizio) ?? `${rChiusa}  `;
          const v = virgolaDopo(src, e.elementi[e.elementi.length - 1], e.chiude);
          if (v) modifiche.push(v);
          modifiche.push({ da: inizioRiga(src, e.chiude), a: inizioRiga(src, e.chiude), testo: daPortare[chiave].map((t) => `${rEl}${t},\n`).join('') });
        } else {
          const rKey = rientro(src, e.prop.inizio) ?? rProp;
          const tutti = e.elementi.map((x) => src.slice(x.inizio, x.fine)).concat(daPortare[chiave]);
          modifiche.push({ da: e.apre, a: e.chiude + 1, testo: `[\n${tutti.map((t) => `${rKey}  ${t},\n`).join('')}${rKey}]` });
        }
      }
    } else {
      const primo = mappa.blocchi.find((_, b) => attesi[b] !== null) || mappa.blocchi[0];
      const r0 = primo ? rientro(src, primo.inizio) : null;
      if (r0 === null) return { ok: false, motivo: 'il primo blocco del registro non comincia una riga: apri il blocco a mano' };
      const nuovo = { version: p.versione, date: oggi };
      let t = `${r0}{\n${r0}  version: '${p.versione}', date: '${oggi}',\n`;
      for (const chiave of CHIAVI) {
        if (!daPortare[chiave].length) continue;
        nuovo[chiave] = portate(chiave);
        t += `${r0}  ${chiave}: [\n${daPortare[chiave].map((x) => `${r0}    ${x},\n`).join('')}${r0}  ],\n`;
      }
      t += `${r0}},\n`;
      attesi.unshift(nuovo);
      const da = inizioRiga(src, mappa.blocchi[0].inizio);
      modifiche.push({ da, a: da, testo: t });
    }

    let nuovoSrc;
    try { nuovoSrc = applica(src, modifiche); } catch (e) { return { ok: false, motivo: e.message }; }
    let riletto;
    try { riletto = leggiRegistro(nuovoSrc); } catch (e) { return { ok: false, motivo: `lo spostamento non darebbe un registro valido (${e.message}): sposta le righe a mano` }; }
    if (json(riletto) !== json(attesi.filter((n) => n !== null))) {
      return { ok: false, motivo: 'lo spostamento non darebbe esattamente il registro atteso: sposta le righe a mano' };
    }
    return { ok: true, src: nuovoSrc, spostate: sposta.map(({ version, chiave, riga }) => ({ version, chiave, riga })), verso: p.versione };
  }

  global.SN_NOVITA_IN_CIMA = {
    FILE_NOVITA, CAMPO, cmpVersion, testo, prossimaVersione, leggiRegistro, aggiunteSottoUscite, sottoUsciteSuMain, spostaInCima,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
