// Il registro delle novità letto dal sorgente, senza eseguirlo, e le righe di un ramo unite a quello di main (#2543):
// la regola che la prova degli unit sulla fusione e il server applicano uguale. Niente dipendenze né globali dell'app:
// il server la incorpora (bake). Sentinelle: tests/unit/novitaFusione.test.mjs, tests/unit/novitaInCima.test.mjs.

(function (global) {
  'use strict';

  const FILE = 'src/shared/patchNotes.js';
  const CAMPO = 'prossimaVersione';
  const CHIAVI = ['features', 'fixes'];
  const A_B_C = /^\d+\.\d+\.\d+$/;

  function confrontaVersioni(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
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
    if (confrontaVersioni(dichiarata, attuale) <= 0) {
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

  /** I blocchi del registro nel sorgente, ognuno coi suoi limiti e le sue proprietà. */
  function blocchiSorgente(src) {
    const m = /\bconst\s+NOTES\s*=\s*\[/.exec(src);
    if (!m) throw new Error('non trovo «const NOTES = [»');
    const apre = m.index + m[0].length - 1;
    const { chiude, elementi: blocchi } = elementi(src, apre);
    return {
      apre, chiude,
      blocchi: blocchi.map((b) => {
        if (src[b.inizio] !== '{') throw new Error(`un blocco del registro non è un oggetto (carattere ${b.inizio})`);
        const { chiude: fineOggetto, props } = proprieta(src, b.inizio);
        return Object.assign({}, b, { chiudeOggetto: fineOggetto, props });
      }),
    };
  }

  /**
   * Le proprietà scritte due volte nello stesso blocco: eseguito, l'oggetto tiene solo l'ultima e le righe dell'altra
   * spariscono senza errore, anche al confronto (#2320). `[{ version, chiave }]`; lancia se il testo non si legge.
   */
  function chiaviDoppie(src) {
    const out = [];
    blocchiSorgente(src).blocchi.forEach((b, k) => {
      const v = b.props.find((p) => p.nome === 'version');
      const scritta = v && /^(['"`])([^'"`\\]*)\1/.exec(src.slice(v.valore, v.fine));
      const version = scritta ? scritta[2] : `n. ${k + 1}`;
      const nomi = b.props.map((p) => p.nome).filter(Boolean);
      for (const chiave of new Set(nomi.filter((n, i) => nomi.indexOf(n) !== i))) out.push({ version, chiave });
    });
    return out;
  }

  /** Il motivo da stampare per le chiavi doppie di chiaviDoppie. */
  function testoChiaviDoppie(doppie) {
    const dove = doppie.map((d) => `nel blocco ${d.version} «${d.chiave}»`).join(', ');
    return `${dove} ${doppie.length === 1 ? 'è scritto' : 'sono scritti'} due volte: vale solo l'ultimo, e le righe dell'altro spariscono dal registro. `
      + 'Uniscili in uno solo, poi rilancia';
  }

  /** La mappa del registro nel sorgente: per ogni blocco i suoi limiti e, per features e fixes, l'elenco e i suoi elementi. */
  function mappaSorgente(src) {
    const { apre, chiude, blocchi } = blocchiSorgente(src);
    return {
      apre, chiude,
      blocchi: blocchi.map((b) => {
        const elenchi = {};
        for (const p of b.props) {
          if (!CHIAVI.includes(p.nome)) continue;
          if (src[p.valore] !== '[') throw new Error(`«${p.nome}» non è un elenco scritto per esteso (carattere ${p.valore})`);
          const e = elementi(src, p.valore);
          elenchi[p.nome] = { prop: p, apre: p.valore, chiude: e.chiude, elementi: e.elementi };
        }
        return Object.assign({}, b, { elenchi });
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
    const ord = [...modifiche].sort((x, y) => y.da - x.da || y.a - x.a);
    for (let k = 1; k < ord.length; k++) {
      if (ord[k].a > ord[k - 1].da) throw new Error('due modifiche si sovrappongono: il registro va sistemato a mano');
    }
    let out = src;
    for (const m of ord) out = out.slice(0, m.da) + m.testo + out.slice(m.a);
    return out;
  }

  /**
   * Le modifiche che aggiungono `daPortare` ({ features, fixes }: testi di righe) in fondo agli elenchi del blocco `cima`
   * (della mappa di `src`), o, senza, in un blocco `versione` nuovo aperto sopra `primo` con la data `oggi`.
   * → { ok: true, modifiche, featuresPrimaDiFixes } | { ok: false, motivo }
   */
  function modificheInCima(src, { cima = null, primo = null, versione, oggi, daPortare }) {
    const modifiche = [];
    let featuresPrimaDiFixes = false;
    if (cima) {
      const rProp = rientro(src, cima.props[0].inizio);
      const rChiude = rientro(src, cima.chiudeOggetto);
      if (rProp === null || rChiude === null) return { ok: false, motivo: `il blocco ${versione} non è scritto una proprietà per riga: aggiungi le righe a mano` };
      for (const chiave of CHIAVI) {
        if (!daPortare[chiave].length) continue;
        const e = cima.elenchi[chiave];
        if (!e) {
          const corpo = daPortare[chiave].map((t) => `${rProp}  ${t},\n`).join('');
          // Al posto dove main scrive lo stesso elenco: un suo `features` nello stesso blocco diventa un conflitto del
          // rebase, non una chiave doppia che ne cancella le righe in silenzio (#2320).
          const correzioni = chiave === 'features' && cima.elenchi.fixes && cima.elenchi.fixes.prop;
          if (correzioni && rientro(src, correzioni.inizio) !== null) {
            featuresPrimaDiFixes = true;
            const da = inizioRiga(src, correzioni.inizio);
            modifiche.push({ da, a: da, testo: `${rProp}${chiave}: [\n${corpo}${rProp}],\n` });
            continue;
          }
          const ultima = cima.props[cima.props.length - 1];
          const v = virgolaDopo(src, ultima, cima.chiudeOggetto);
          if (v) modifiche.push(v);
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
          const tutti = [...e.elementi.map((x) => src.slice(x.inizio, x.fine)), ...daPortare[chiave]];
          modifiche.push({ da: e.apre, a: e.chiude + 1, testo: `[\n${tutti.map((t) => `${rKey}  ${t},\n`).join('')}${rKey}]` });
        }
      }
      return { ok: true, modifiche, featuresPrimaDiFixes };
    }
    const r0 = primo ? rientro(src, primo.inizio) : null;
    if (r0 === null) return { ok: false, motivo: 'il primo blocco del registro non comincia una riga: apri il blocco a mano' };
    let t = `${r0}{\n${r0}  version: '${versione}', date: '${oggi}',\n`;
    for (const chiave of CHIAVI) {
      if (!daPortare[chiave].length) continue;
      t += `${r0}  ${chiave}: [\n${daPortare[chiave].map((x) => `${r0}    ${x},\n`).join('')}${r0}  ],\n`;
    }
    t += `${r0}},\n`;
    const da = inizioRiga(src, primo.inizio);
    modifiche.push({ da, a: da, testo: t });
    return { ok: true, modifiche, featuresPrimaDiFixes };
  }

  // ── Le righe del ramo unite al registro di main ──

  // Una riga che si sposta è un dato e solo un dato: una stringa su una riga, o { testo, segnalazione }. Il server
  // scrive su main quello che questa regola produce, quindi niente che, eseguito, possa fare altro (#2543).
  const STRINGA = String.raw`(?:'(?:[^'\\\n\r]|\\[^\n\r])*'|"(?:[^"\\\n\r]|\\[^\n\r])*")`;
  const RIGA_DATI = new RegExp(String.raw`^(?:${STRINGA}|\{\s*testo\s*:\s*${STRINGA}\s*(?:,\s*segnalazione\s*:\s*\d{1,9}\s*)?,?\s*\})$`);
  const rigaDiDati = (t) => RIGA_DATI.test(String(t));

  /** Blocchi del sorgente, ognuno con la sua versione e i testi delle sue righe (null per un elenco che non c'è). Lancia. */
  function vociDi(src) {
    const doppie = chiaviDoppie(src);
    if (doppie.length) throw new Error(testoChiaviDoppie(doppie));
    const mappa = mappaSorgente(src);
    const blocchi = mappa.blocchi.map((b, k) => {
      const v = b.props.find((p) => p.nome === 'version');
      const m = v && /^(['"])(\d+\.\d+\.\d+)\1$/.exec(src.slice(v.valore, v.fine));
      if (!m) throw new Error(`il blocco n. ${k + 1} non ha una versione a.b.c scritta per esteso`);
      const voci = {};
      for (const c of CHIAVI) voci[c] = b.elenchi[c] ? b.elenchi[c].elementi.map((e) => src.slice(e.inizio, e.fine)) : null;
      return { version: m[2], voci };
    });
    const versioni = blocchi.map((b) => b.version);
    const doppia = versioni.find((v, k) => versioni.indexOf(v) !== k);
    if (doppia) throw new Error(`il blocco ${doppia} compare due volte`);
    return { mappa, blocchi };
  }

  /** Gli indici delle righe di `ora` che `prima` non ha (contate una a una) e le righe di `prima` che `ora` non ha più. */
  function differenza(ora, prima) {
    const resto = [...prima];
    const nuove = [];
    ora.forEach((x, i) => { const j = resto.indexOf(x); if (j >= 0) resto.splice(j, 1); else nuove.push(i); });
    return { nuove, tolte: resto };
  }

  /**
   * Le righe che il registro `fuso` ha in più di quello di `main` sotto versioni fino a `uscita` compresa: quelle che
   * la sentinella del registro darebbe rosse sulla fusione. Lancia se un registro non si legge.
   */
  function sottoUscite({ main, fuso, uscita }) {
    if (!A_B_C.test(String(uscita || ''))) throw new Error(`versione uscita «${uscita}» non nella forma a.b.c`);
    const M = vociDi(String(main));
    const out = [];
    for (const fb of vociDi(String(fuso)).blocchi) {
      if (confrontaVersioni(fb.version, uscita) > 0) continue;
      const mb = M.blocchi.find((x) => x.version === fb.version);
      for (const c of CHIAVI) {
        const ora = fb.voci[c] || [];
        for (const i of differenza(ora, (mb && mb.voci[c]) || []).nuove) out.push({ version: fb.version, chiave: c, riga: ora[i] });
      }
    }
    return out;
  }

  const scheletro = (s) => String(s).replace(/[\s,]/g, '');

  /**
   * Il registro di `main` con, nel blocco della prossima versione, le righe che `ramo` ha aggiunto rispetto a `base`
   * (il punto in cui ramo e main si sono separati): nessuna riga dei due lati persa, nessun doppione. Solo se il ramo il
   * registro l'ha soltanto allungato; un ramo che ha tolto, riscritto o cambiato altro non si unisce a macchina.
   * `manifesto`: il package.json di main. `oggi`: la data di un blocco nuovo.
   * → { ok: true, src, aggiunte: [{ chiave, riga }], verso } | { ok: false, motivo }
   */
  function uniscaNovita({ base, main, ramo, manifesto, oggi }) {
    const no = (motivo) => ({ ok: false, motivo });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(oggi || ''))) return no('data del blocco nuovo non valida');
    let B;
    let M;
    let R;
    try { B = vociDi(String(base)); } catch (e) { return no(`non leggo il registro della base: ${e.message}`); }
    try { M = vociDi(String(main)); } catch (e) { return no(`non leggo il registro di main: ${e.message}`); }
    try { R = vociDi(String(ramo)); } catch (e) { return no(`non leggo il registro del ramo: ${e.message}`); }
    for (const b of B.blocchi) {
      if (!R.blocchi.some((x) => x.version === b.version)) return no(`il ramo ha tolto il blocco ${b.version}`);
    }
    const tagli = [];
    const aggiunte = [];
    for (let k = 0; k < R.blocchi.length; k++) {
      const rb = R.blocchi[k];
      const blocco = R.mappa.blocchi[k];
      const bb = B.blocchi.find((x) => x.version === rb.version);
      if (!bb) {
        tagli.push(tagliaElemento(ramo, blocco, R.mappa.blocchi));
        for (const c of CHIAVI) for (const riga of rb.voci[c] || []) aggiunte.push({ chiave: c, riga });
        continue;
      }
      for (const c of CHIAVI) {
        const { nuove, tolte } = differenza(rb.voci[c] || [], bb.voci[c] || []);
        if (tolte.length) return no(`nel blocco ${rb.version} il ramo ha tolto o riscritto righe che c'erano: va unito a mano`);
        if (!nuove.length) continue;
        for (const i of nuove) aggiunte.push({ chiave: c, riga: rb.voci[c][i] });
        const e = blocco.elenchi[c];
        if (!bb.voci[c]) tagli.push(tagliaElemento(ramo, e.prop, blocco.props));
        else for (const i of nuove) tagli.push(tagliaElemento(ramo, e.elementi[i], e.elementi));
      }
    }
    // Tolte le righe nuove, il registro del ramo dev'essere quello della base: un'altra modifica si perderebbe.
    let resto;
    try { resto = applica(String(ramo), tagli); } catch (e) { return no(e.message); }
    if (scheletro(resto) !== scheletro(base)) return no('il ramo ha cambiato il registro anche fuori dalle righe aggiunte: va unito a mano');
    const strana = aggiunte.find((a) => !rigaDiDati(a.riga));
    if (strana) return no(`una riga del ramo non è un semplice testo (${strana.riga.slice(0, 80)}): va unita a mano`);

    const giaSuMain = new Set(M.blocchi.flatMap((b) => CHIAVI.flatMap((c) => b.voci[c] || [])));
    const viste = new Set();
    const nuove = aggiunte.filter((a) => {
      if (giaSuMain.has(a.riga) || viste.has(a.riga)) return false;
      viste.add(a.riga);
      return true;
    });
    const p = prossimaVersione(manifesto);
    if (p.errore) return no(p.errore);
    if (!nuove.length) return { ok: true, src: String(main), aggiunte: [], verso: p.versione };

    const uscita = String(manifesto.version);
    const sopra = M.blocchi.filter((n) => confrontaVersioni(n.version, uscita) > 0);
    if (sopra.length > 1 || (sopra.length && (sopra[0] !== M.blocchi[0] || sopra[0].version !== p.versione))) {
      return no(`sopra la versione ${uscita} main ha i blocchi ${sopra.map((n) => n.version).join(', ')}: ne serve uno solo, ${p.versione}, in cima`);
    }
    const daPortare = { features: [], fixes: [] };
    for (const a of nuove) daPortare[a.chiave].push(a.riga);
    const m = modificheInCima(String(main), {
      cima: sopra.length ? M.mappa.blocchi[0] : null, primo: M.mappa.blocchi[0], versione: p.versione, oggi, daPortare,
    });
    if (!m.ok) return no(m.motivo);
    let src;
    try { src = applica(String(main), m.modifiche); } catch (e) { return no(e.message); }

    // Riletto, il risultato è main con le righe nuove in fondo agli elenchi del blocco in cima, e nient'altro.
    let F;
    try { F = vociDi(src); } catch (e) { return no(`l'unione non darebbe un registro leggibile (${e.message})`); }
    const attesi = M.blocchi.map((b) => ({ version: b.version, voci: Object.assign({}, b.voci) }));
    if (!sopra.length) attesi.unshift({ version: p.versione, voci: { features: null, fixes: null } });
    for (const c of CHIAVI) {
      if (daPortare[c].length) attesi[0].voci[c] = [...(attesi[0].voci[c] || []), ...daPortare[c]];
    }
    if (JSON.stringify(F.blocchi) !== JSON.stringify(attesi)) return no('l\'unione non darebbe esattamente il registro atteso: va unito a mano');
    return { ok: true, src, aggiunte: nuove, verso: p.versione };
  }

  global.SN_NOVITA_FUSIONE = {
    FILE, CAMPO, CHIAVI,
    confrontaVersioni, prossimaVersione,
    chiaviDoppie, testoChiaviDoppie, mappaSorgente, tagliaElemento, applica, rientro, modificheInCima,
    rigaDiDati, sottoUscite, uniscaNovita,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
