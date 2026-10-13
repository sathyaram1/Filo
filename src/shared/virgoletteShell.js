// Virgolette ai percorsi nei comandi di shell (#968): quali percorsi le vogliono e come si scrivono, per shell
// EFFETTIVA (resolveShell in src/main/services/terminal.js). L'esistenza la dice chi chiama: qui niente disco.
// Mai una correzione muta: il risultato si mostra prima di eseguirlo. Regole: tests/unit/virgoletteShell.test.mjs.

(function (global) {
  'use strict';

  // Scritti nudi in un percorso, questi lo spezzano in due o ne cambiano il senso.
  const ROMPONO = {
    sh: /[\s'"\\$`&;|<>()]/,
    bash: /[\s'"\\$`&;|<>()]/,
    // PowerShell prende per virgolette anche quelle tipografiche: «l’archivio» si spezza come «l'archivio».
    powershell: /[\s'"`$&;|<>(){},\u2018\u2019\u201a\u201b\u201c\u201d\u201e]/,
    cmd: /[\s&|<>^(),;=]/,
  };

  const SINGOLE_PS = "'\u2018\u2019\u201a\u201b";
  const DOPPIE_PS = '"\u201c\u201d\u201e';
  const REGOLE = {
    sh: { singole: "'", doppie: '"', fuga: '\\', fugaDoppie: '\\' },
    bash: { singole: "'", doppie: '"', fuga: '\\', fugaDoppie: '\\' },
    powershell: { singole: SINGOLE_PS, doppie: DOPPIE_PS, fuga: '`', fugaDoppie: '`', raddoppio: true },
    cmd: { singole: '', doppie: '"', fuga: '^', fugaDoppie: '' },
  };

  const OPERATORE = /[;&|<>]/;
  const SPAZIO = /\s/;
  // Oltre, un'esplorazione costerebbe più di quanto vale un suggerimento: il comando gira comunque com'è.
  const MAX_PEZZI_PER_PERCORSO = 32;
  const MAX_CONTROLLI = 2000;

  function regole(shell) { return REGOLE[shell] || null; }

  function serveQuotare(testo, shell) {
    const r = ROMPONO[shell];
    return !!(r && r.test(String(testo || '')));
  }

  // Fine della stringa fra virgolette che si apre in `da`, o -1 se resta aperta.
  function chiusura(s, da, famiglia, fuga, raddoppio) {
    let k = da + 1;
    while (k < s.length) {
      const c = s[k];
      if (fuga && c === fuga) { k += 2; continue; }
      if (famiglia.includes(c)) {
        if (raddoppio && famiglia.includes(s[k + 1])) { k += 2; continue; }
        return k;
      }
      k++;
    }
    return -1;
  }

  // Parole e operatori della riga, con le posizioni. `protetto`: la parola ha già virgolette o fughe sue.
  // `aperto`: una virgoletta resta aperta in fondo. Con `letterale` virgolette e fughe sono caratteri qualsiasi.
  function scomponi(riga, shell, { letterale = false } = {}) {
    const s = String(riga || '');
    const r = regole(shell) || REGOLE.sh;
    const pezzi = [];
    let aperto = false;
    let i = 0;
    while (i < s.length) {
      if (SPAZIO.test(s[i])) { i++; continue; }
      if (OPERATORE.test(s[i])) {
        let j = i + 1;
        while (j < s.length && OPERATORE.test(s[j])) j++;
        pezzi.push({ inizio: i, fine: j, testo: s.slice(i, j), operatore: true, protetto: false });
        i = j;
        continue;
      }
      let j = i;
      let protetto = false;
      while (j < s.length && !SPAZIO.test(s[j]) && !OPERATORE.test(s[j])) {
        const c = s[j];
        if (!letterale && r.fuga && c === r.fuga) { protetto = true; j += 2; continue; }
        const singola = !letterale && r.singole.includes(c);
        const doppia = !letterale && r.doppie.includes(c);
        if (singola || doppia) {
          protetto = true;
          const k = singola
            ? chiusura(s, j, r.singole, '', r.raddoppio)
            : chiusura(s, j, r.doppie, r.fugaDoppie, r.raddoppio);
          if (k < 0) { aperto = true; j = s.length; break; }
          j = k + 1;
          continue;
        }
        j++;
      }
      j = Math.min(j, s.length);
      pezzi.push({ inizio: i, fine: j, testo: s.slice(i, j), operatore: false, protetto });
      i = j;
    }
    return { pezzi, aperto };
  }

  function giaFraVirgolette(testo, shell) {
    const r = regole(shell);
    if (!r || testo.length < 2) return false;
    const famiglie = [r.singole, r.doppie].filter(Boolean);
    return famiglie.some((f) => f.includes(testo[0]) && f.includes(testo[testo.length - 1]));
  }

  // Il percorso scritto per la shell. `comando`: sta dove la shell aspetta il programma, e PowerShell lì vuole `&`
  // (una stringa da sola la stamperebbe soltanto). Null se questa shell non sa scriverlo.
  function quota(percorso, shell, { comando = false } = {}) {
    let testo = String(percorso || '');
    if (!regole(shell) || !testo || /[\r\n\0]/.test(testo)) return null;
    let davanti = '';
    // Fra virgolette sh non espande la tilde: resta fuori, davanti.
    if (shell === 'sh' || shell === 'bash') {
      const m = /^~[\\/]/.exec(testo);
      if (m) { davanti = m[0]; testo = testo.slice(m[0].length); }
    }
    // `"C:\Nome Cognome\"`: per molti programmi Windows `\"` è una virgoletta scritta, non la chiusura.
    if (shell === 'powershell' || shell === 'cmd') {
      const senza = testo.replace(/[\\/]+$/, '');
      if (senza && !senza.endsWith(':')) testo = senza;
    }
    if (!testo) return null;
    let fra;
    if (shell === 'cmd') {
      if (testo.includes('"')) return null;
      fra = `"${testo}"`;
    } else if (shell === 'powershell') {
      fra = /["`$\u201c\u201d\u201e]/.test(testo)
        ? `'${testo.replace(/['\u2018\u2019\u201a\u201b]/g, (c) => c + c)}'`
        : `"${testo}"`;
    } else {
      fra = /["`$\\]/.test(testo) ? `'${testo.replace(/'/g, "'\\''")}'` : `"${testo}"`;
    }
    return `${comando && shell === 'powershell' ? '& ' : ''}${davanti}${fra}`;
  }

  // Dove la shell aspetta il nome di un programma, dato l'ultimo pezzo prima (nessuno = inizio riga).
  function posizione(prec, shell) {
    const comando = !prec || (prec.operatore && !/[<>]/.test(prec.testo));
    const chiamata = shell === 'powershell' && !!prec && prec.operatore && prec.testo === '&';
    return { comando, chiamata };
  }

  // Un testo appena incollato (o trascinato) in `riga` fra `inizio` e `fine`. Se è un percorso intero che esiste
  // e la riga è un comando di shell (`/…`), torna il pezzo da mettere al suo posto: { inizio, fine, testo }.
  // `esiste(percorso)` → 'file' | 'cartella' | null, anche asincrona.
  async function virgoletteIncollando({ riga, inizio, fine, shell } = {}, esiste) {
    const s = String(riga == null ? '' : riga);
    if (!ROMPONO[shell] || typeof esiste !== 'function') return null;
    if (!Number.isInteger(inizio) || !Number.isInteger(fine) || inizio < 0 || fine <= inizio || fine > s.length) return null;
    const incollato = s.slice(inizio, fine);
    const a = inizio + (incollato.length - incollato.trimStart().length);
    const b = fine - (incollato.length - incollato.trimEnd().length);
    if (b <= a) return null;
    const percorso = s.slice(a, b);
    if (/[\r\n\0]/.test(percorso) || giaFraVirgolette(percorso, shell) || !serveQuotare(percorso, shell)) return null;
    const prima = s.slice(0, a).trimStart();
    if (!prima.startsWith('/')) return null;
    const interno = prima.slice(1);
    const dopo = s.slice(b);
    // Incollato attaccato a un'altra parola non è un percorso intero: è un pezzo di quella.
    if (interno && !/[\s;&|]$/.test(interno)) return null;
    if (dopo && !/^[\s;&|]/.test(dopo)) return null;
    const { pezzi, aperto } = scomponi(interno, shell);
    if (aperto) return null;
    const { comando, chiamata } = posizione(pezzi[pezzi.length - 1], shell);
    if (!(await esiste(percorso))) return null;
    const testo = quota(percorso, shell, { comando: comando && !chiamata });
    if (!testo || testo === percorso) return null;
    return { inizio: a, fine: b, testo };
  }

  // Un comando fallito: ogni tratto di parole nude che insieme fanno un percorso esistente torna fra virgolette.
  // { comando, pezzi: [{ testo, aggiunto }] } (aggiunto = il tratto riscritto), o null se non c'è niente da proporre.
  async function propostaVirgolette(comando, shell, esiste) {
    const s = String(comando == null ? '' : comando);
    if (!ROMPONO[shell] || typeof esiste !== 'function' || !s.trim() || /[\r\n\0]/.test(s)) return null;
    let { pezzi, aperto } = scomponi(s, shell);
    // Una virgoletta rimasta aperta è proprio l'errore («cd l'archivio»): lì è un carattere del nome.
    if (aperto) pezzi = scomponi(s, shell, { letterale: true }).pezzi;
    const cambi = [];
    let controlli = 0;
    let i = 0;
    cerca: while (i < pezzi.length) {
      const p = pezzi[i];
      if (p.operatore || p.protetto) { i++; continue; }
      const { comando: inComando, chiamata } = posizione(pezzi[i - 1], shell);
      let ultimo = Math.min(pezzi.length - 1, i + MAX_PEZZI_PER_PERCORSO - 1);
      for (let k = i; k <= ultimo; k++) if (pezzi[k].protetto) { ultimo = k - 1; break; }
      let preso = null;
      for (let j = ultimo; j >= i; j--) {
        if (pezzi[j].operatore) continue;
        const testo = s.slice(p.inizio, pezzi[j].fine);
        if (!serveQuotare(testo, shell)) continue;
        if (++controlli > MAX_CONTROLLI) break cerca;
        const tipo = await esiste(testo);
        // Una cartella al posto del programma non si esegue nemmeno fra virgolette.
        if (!tipo || (inComando && tipo !== 'file')) continue;
        preso = { j, testo };
        break;
      }
      if (!preso) { i++; continue; }
      const nuovo = quota(preso.testo, shell, { comando: inComando && !chiamata });
      if (nuovo && nuovo !== preso.testo) cambi.push({ inizio: p.inizio, fine: pezzi[preso.j].fine, testo: nuovo });
      i = preso.j + 1;
    }
    if (!cambi.length) return null;
    const parti = [];
    let da = 0;
    for (const c of cambi) {
      if (c.inizio > da) parti.push({ testo: s.slice(da, c.inizio), aggiunto: false });
      parti.push({ testo: c.testo, aggiunto: true });
      da = c.fine;
    }
    if (da < s.length) parti.push({ testo: s.slice(da), aggiunto: false });
    return { comando: parti.map((x) => x.testo).join(''), pezzi: parti };
  }

  // Il programma che la riga lancia, senza le virgolette e senza la `&` di PowerShell: per sapere se esiste.
  function primoComando(riga) {
    let s = String(riga || '').trimStart();
    s = s.replace(/^&\s+/, '');
    const q = s[0];
    if (q === '"' || q === "'") {
      const k = s.indexOf(q, 1);
      return k > 0 ? s.slice(1, k) : s.slice(1);
    }
    return s.split(/\s+/)[0] || '';
  }

  // Basta questo per valere una domanda al disco: una riga sola, non già fra virgolette, con qualcosa da proteggere.
  function forseDaQuotare(testo) {
    const t = String(testo || '').trim();
    if (!t || /[\r\n\0]/.test(t)) return false;
    if (/^(["'\u2018\u2019\u201c\u201d]).*\1$/.test(t) && t.length > 1) return false;
    return /[\s'"`$&;|<>(){},^=\u2018\u2019\u201a\u201b\u201c\u201d\u201e]/.test(t);
  }

  global.SN_VIRGOLETTE = {
    serveQuotare, quota, scomponi, virgoletteIncollando, propostaVirgolette, primoComando, forseDaQuotare,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
