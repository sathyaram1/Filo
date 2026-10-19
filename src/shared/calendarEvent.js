// Un evento proposto da Filo in chat → il file .ics che il calendario del
// computer sa aprire. Logica pura: niente disco, niente Electron.
// Regole e casi limite: tests/unit/calendarEvent.test.mjs.

(function (global) {
  'use strict';

  const DUE_CIFRE = (n) => String(n).padStart(2, '0');

  // Il testo che entra in un campo .ics: RFC 5545 vuole questi quattro
  // caratteri protetti, e un a capo vero spezzerebbe il file in due righe che
  // il calendario non sa leggere.
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  // Le righe di un .ics non superano i 75 ottetti: si spezzano continuando con
  // uno spazio in testa. Si conta in byte, non in caratteri: un titolo con gli
  // accenti supera il limite prima di quanto sembri.
  function piega(riga) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '';
    let byte = 0;
    for (const ch of String(riga)) {
      const n = enc.encode(ch).length;
      const max = out.length ? 74 : 75; // le righe di continuazione perdono un ottetto per lo spazio
      if (byte + n > max) { out.push(cur); cur = ''; byte = 0; }
      cur += ch;
      byte += n;
    }
    out.push(cur);
    return out.map((r, i) => (i ? ` ${r}` : r)).join('\r\n');
  }

  // «2026-09-21» + «10:00» → i pezzi, o null se non è una data e un'ora vere
  // (il 31 febbraio non lo è: il modello inventa, e un evento che il calendario
  // rifiuta è peggio di un evento non proposto).
  function pezziData(data, ora) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data || '').trim());
    const t = /^(\d{1,2})[:.](\d{2})$/.exec(String(ora || '').trim());
    if (!d || !t) return null;
    const [Y, M, D] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const [h, m] = [Number(t[1]), Number(t[2])];
    if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59) return null;
    const dt = new Date(Date.UTC(Y, M - 1, D, h, m, 0));
    if (dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D) return null;
    return dt;
  }

  function stampaGiorno(dt) {
    return `${dt.getUTCFullYear()}${DUE_CIFRE(dt.getUTCMonth() + 1)}${DUE_CIFRE(dt.getUTCDate())}`;
  }

  function stampaLocale(dt) {
    return `${stampaGiorno(dt)}T${DUE_CIFRE(dt.getUTCHours())}${DUE_CIFRE(dt.getUTCMinutes())}00`;
  }

  // Un compleanno o una scadenza un'ora non ce l'hanno: senza ora (o col
  // segno esplicito) l'evento occupa la giornata, invece di un'ora inventata.
  // Un'ora scritta male resta un errore: non diventa «tutto il giorno».
  function senzaOra(o, ora) {
    const flag = o.tutto_il_giorno ?? o.tuttoIlGiorno ?? o.allDay ?? o.all_day;
    if (flag === true || flag === 'true') return true;
    return ora == null || String(ora).trim() === '';
  }

  const GIORNO_MS = 24 * 60 * 60_000;
  const MAX_GIORNI = 366;
  const isoGiorno = (dt) => `${dt.getUTCFullYear()}-${DUE_CIFRE(dt.getUTCMonth() + 1)}-${DUE_CIFRE(dt.getUTCDate())}`;
  const leggibile = (dt) => `${dt.getUTCDate()}/${DUE_CIFRE(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
  const orario = (dt) => `${DUE_CIFRE(dt.getUTCHours())}:${DUE_CIFRE(dt.getUTCMinutes())}`;
  const vuoto = (v) => v == null || String(v).trim() === '';
  // Il valore sbagliato torna nel perché, accorciato: lo scrive il modello, e un rifiuto non deve diventare un muro di testo.
  const citato = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > 40 ? `${t.slice(0, 39)}…` : t; };
  const oltreUnAnno = (giorni) => `dura ${giorni} giorni, più di un anno: non è un evento che il calendario possa tenere`;

  // Una fine che non si può rispettare si RIFIUTA col suo perché, che arriva al modello e alla riga del diario:
  // tagliata o ignorata in silenzio, nel calendario entrava un altro evento (#567, nono giro).
  function verifica(a) {
    const o = a || {};
    const titolo = String(o.titolo ?? o.title ?? o.nome ?? o.name ?? '').replace(/\s+/g, ' ').trim();
    const data = o.data ?? o.date ?? o.giorno;
    const ora = o.ora ?? o.orario ?? o.time ?? o.hour;
    const dataFine = o.data_fine ?? o.dataFine ?? o.fino_al ?? o.end_date ?? o.endDate;
    const oraFine = o.ora_fine ?? o.oraFine ?? o.end_time ?? o.endTime;
    if (!titolo) return { errore: 'manca il titolo' };
    const tutto = senzaOra(o, ora);
    const giorno = pezziData(data, '00:00');
    if (!giorno) return { errore: `data o ora non valide: «${citato(data)}» non è un giorno` };
    const ultimo = vuoto(dataFine) ? null : pezziData(dataFine, '00:00');
    if (!vuoto(dataFine) && !ultimo) return { errore: `ultimo giorno non valido: «${citato(dataFine)}» non è un giorno` };
    if (ultimo && ultimo < giorno) {
      return { errore: `l'ultimo giorno (${leggibile(ultimo)}) viene prima del primo (${leggibile(giorno)})` };
    }
    const c = {
      titolo: titolo.slice(0, 200),
      dettagli: String(o.dettagli ?? o.details ?? o.descrizione ?? o.description ?? o.note ?? '').trim().slice(0, 2000),
      luogo: String(o.luogo ?? o.location ?? o.dove ?? '').trim().slice(0, 200),
    };
    const durataScritta = Number(o.durata_min ?? o.durataMin ?? o.durata ?? o.duration);
    const durataValida = Number.isFinite(durataScritta) && durataScritta > 0;
    if (tutto) {
      // L'ultimo giorno vince sulla durata: le ferie dal 10 al 15 sono sei giorni (#567, ottavo giro).
      let giorni = 1;
      if (ultimo) giorni = Math.round((ultimo - giorno) / GIORNO_MS) + 1;
      else if (durataValida) giorni = Math.ceil(durataScritta / (24 * 60));
      if (giorni > MAX_GIORNI) return { errore: oltreUnAnno(giorni) };
      const fineGiorno = new Date(giorno.getTime() + (giorni - 1) * GIORNO_MS);
      return {
        evento: {
          titolo: c.titolo,
          data: isoGiorno(giorno),
          ora: '',
          tuttoIlGiorno: true,
          dataFine: isoGiorno(fineGiorno),
          dettagli: c.dettagli,
          luogo: c.luogo,
          inizio: stampaGiorno(giorno),
          fine: stampaGiorno(new Date(giorno.getTime() + giorni * GIORNO_MS)),
          durataMin: giorni * 24 * 60,
          quando: giorni > 1
            ? `dal ${leggibile(giorno)} al ${leggibile(fineGiorno)}, tutto il giorno`
            : `${leggibile(giorno)}, tutto il giorno`,
        },
      };
    }
    const inizio = pezziData(data, ora);
    if (!inizio) return { errore: `data o ora non valide: «${citato(ora)}» non è un'ora` };
    if (!vuoto(oraFine) && !pezziData(data, oraFine)) return { errore: `ora di fine non valida: «${citato(oraFine)}» non è un'ora` };
    // Una regola sola per la fine: l'ultimo giorno dice IN CHE GIORNO finisce, l'ora di fine o la durata A CHE ORA.
    // L'ora di fine vince sulla durata; la durata (o l'ora di default) vale se cade nell'ultimo giorno, altrimenti
    // l'ultimo giorno si occupa tutto («torno il 15» non dice a che ora). Un ultimo giorno uguale al primo non
    // allunga niente (#567, decimo giro).
    let fine = null;
    if (!vuoto(oraFine)) {
      fine = pezziData(isoGiorno(ultimo || giorno), oraFine);
      // «dalle 22 alle 2» senza un ultimo giorno passa la mezzanotte.
      if (!ultimo && fine <= inizio) fine = new Date(fine.getTime() + GIORNO_MS);
    } else {
      fine = new Date(inizio.getTime() + (durataValida ? Math.round(durataScritta) : 60) * 60_000);
      if (ultimo && isoGiorno(new Date(fine.getTime() - 60_000)) !== isoGiorno(ultimo)) {
        fine = new Date(ultimo.getTime() + GIORNO_MS);
      }
    }
    if (fine <= inizio) return { errore: `la fine (${leggibile(fine)} alle ${orario(fine)}) viene prima dell'inizio` };
    const durata = Math.round((fine - inizio) / 60_000);
    if (durata > MAX_GIORNI * 24 * 60) return { errore: oltreUnAnno(Math.ceil(durata / (24 * 60))) };
    const ultimoGiorno = new Date(fine.getTime() - 60_000);
    const piuGiorni = isoGiorno(ultimoGiorno) !== isoGiorno(inizio);
    let quando = `${leggibile(inizio)} alle ${orario(inizio)}`;
    if (ultimo || !vuoto(oraFine)) {
      // A mezzanotte finisce la giornata intera: si nomina il giorno, non «alle 00:00» del giorno dopo.
      const giornataIntera = orario(fine) === '00:00';
      if (piuGiorni) quando = `dal ${quando} al ${leggibile(giornataIntera ? ultimoGiorno : fine)}${giornataIntera ? '' : ` alle ${orario(fine)}`}`;
      else quando = `${quando}, fino alle ${orario(fine)}`;
    }
    return {
      evento: {
        titolo: c.titolo,
        // In forma canonica, così l'evento già normalizzato può tornare al main
        // dal bottone della chat e ripassare di qui senza perdere niente.
        data: isoGiorno(inizio),
        ora: orario(inizio),
        tuttoIlGiorno: false,
        dataFine: ultimo ? isoGiorno(ultimo) : '',
        oraFine: vuoto(oraFine) ? '' : orario(fine),
        dettagli: c.dettagli,
        luogo: c.luogo,
        inizio: stampaLocale(inizio),
        fine: stampaLocale(fine),
        durataMin: durata,
        // Per l'utente: «21/09/2026 alle 10:00».
        quando,
      },
    };
  }

  // L'evento come lo ha chiamato il modello → i campi che servono, o null. I sinonimi sono quelli che i modelli usano
  // davvero; il perché di un null lo dice `verifica`.
  function normalize(a) {
    return verifica(a).evento || null;
  }

  // Ora in UTC per DTSTAMP/UID. L'evento invece resta in ora «fluttuante»
  // (senza fuso): le 10:00 sono le 10:00 anche se il portatile cambia paese.
  function stampaUtc(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${DUE_CIFRE(d.getUTCMonth() + 1)}${DUE_CIFRE(d.getUTCDate())}`
      + `T${DUE_CIFRE(d.getUTCHours())}${DUE_CIFRE(d.getUTCMinutes())}${DUE_CIFRE(d.getUTCSeconds())}Z`;
  }

  function buildIcs(ev, { now = Date.now(), uid = '' } = {}) {
    if (!ev) return '';
    const id = uid || `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}@filo`;
    const righe = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Filo//Filo//IT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${esc(id)}`,
      `DTSTAMP:${stampaUtc(now)}`,
      // RFC 5545: la giornata intera è una DATA, e la fine è il giorno dopo.
      ev.tuttoIlGiorno ? `DTSTART;VALUE=DATE:${ev.inizio}` : `DTSTART:${ev.inizio}`,
      ev.tuttoIlGiorno ? `DTEND;VALUE=DATE:${ev.fine}` : `DTEND:${ev.fine}`,
      `SUMMARY:${esc(ev.titolo)}`,
    ];
    if (ev.dettagli) righe.push(`DESCRIPTION:${esc(ev.dettagli)}`);
    if (ev.luogo) righe.push(`LOCATION:${esc(ev.luogo)}`);
    righe.push('END:VEVENT', 'END:VCALENDAR');
    return `${righe.map(piega).join('\r\n')}\r\n`;
  }

  // Identità dell'evento, dai suoi campi: lo stesso appuntamento riaperto col
  // bottone deve tornare al calendario con lo STESSO UID, o il calendario lo
  // prende per un secondo appuntamento e l'utente si ritrova la cena due volte.
  function uidPer(ev) {
    const seme = ['titolo', 'inizio', 'fine', 'luogo'].map((k) => String((ev && ev[k]) || '')).join('\u0001');
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < seme.length; i += 1) {
      const c = seme.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(36)}${h2.toString(36)}`;
  }

  // Nome del file sul disco: solo caratteri che ogni sistema accetta, e mai
  // vuoto (un titolo di soli emoji lascerebbe «.ics» e basta).
  function fileName(ev) {
    const base = String((ev && ev.titolo) || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return `${base || 'evento'}.ics`;
  }

  global.SN_CALENDAR = { normalize, verifica, buildIcs, fileName, uidPer, esc };
})(typeof globalThis !== 'undefined' ? globalThis : self);
