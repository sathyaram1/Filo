// Un evento di calendario come file .ics (azione EVENTO_CALENDARIO).
// Non parla con nessun servizio: produce il testo standard che Windows, Mac e
// ogni calendario sanno importare. Le regole di formato stanno in tests/unit/.

(function (global) {
  'use strict';

  // Il titolo e i dettagli li scrive il modello, che può aver letto una pagina
  // di qualcun altro: senza escape una riga «SUMMARY:x\nDTSTART:...» riscrive
  // il file. Qui dentro non passa nessun a capo non voluto.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  // Le righe di un .ics non superano i 75 ottetti: quelle più lunghe
  // continuano sulla riga dopo, che comincia con uno spazio.
  function piega(riga) {
    const s = String(riga);
    if (s.length <= 74) return s;
    const out = [s.slice(0, 74)];
    let resto = s.slice(74);
    while (resto.length > 73) { out.push(` ${resto.slice(0, 73)}`); resto = resto.slice(73); }
    if (resto) out.push(` ${resto}`);
    return out.join('\r\n');
  }

  const DUE = (n) => String(n).padStart(2, '0');

  function pezziData(data) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data || '').trim());
    if (!m) return null;
    const anno = Number(m[1]); const mese = Number(m[2]); const giorno = Number(m[3]);
    if (mese < 1 || mese > 12 || giorno < 1 || giorno > 31) return null;
    return { anno, mese, giorno };
  }

  function pezziOra(ora) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(ora || '').trim());
    if (!m) return null;
    const h = Number(m[1]); const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return { h, min };
  }

  function nomeFile(titolo) {
    const base = String(titolo || '').replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim();
    return `${(base || 'evento').slice(0, 60)}.ics`;
  }

  /**
   * `{ ok, testo, nome, quando }` oppure `{ ok:false, errore }`. L'ora è
   * "flottante" (senza fuso): «giovedì alle 15» sono le 15 di chi apre il file,
   * che è quello che l'utente ha chiesto.
   */
  function costruisci({ data, ora, titolo, dettagli = '', durataMin = 60, adesso = new Date() } = {}) {
    const d = pezziData(data);
    const o = pezziOra(ora);
    if (!d) return { ok: false, errore: 'data' };
    if (!o) return { ok: false, errore: 'ora' };
    const nome = String(titolo || '').trim();
    if (!nome) return { ok: false, errore: 'titolo' };

    const inizio = new Date(d.anno, d.mese - 1, d.giorno, o.h, o.min, 0, 0);
    if (Number.isNaN(inizio.getTime())) return { ok: false, errore: 'data' };
    const durata = Math.min(Math.max(Number(durataMin) || 60, 5), 24 * 60);
    const fine = new Date(inizio.getTime() + durata * 60000);
    const locale = (x) => `${x.getFullYear()}${DUE(x.getMonth() + 1)}${DUE(x.getDate())}T${DUE(x.getHours())}${DUE(x.getMinutes())}00`;
    const utc = (x) => `${x.getUTCFullYear()}${DUE(x.getUTCMonth() + 1)}${DUE(x.getUTCDate())}T${DUE(x.getUTCHours())}${DUE(x.getUTCMinutes())}${DUE(x.getUTCSeconds())}Z`;
    const uid = `${locale(inizio)}-${Math.random().toString(36).slice(2, 10)}@filo`;

    const righe = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Filo//IT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${utc(adesso)}`,
      `DTSTART:${locale(inizio)}`,
      `DTEND:${locale(fine)}`,
      `SUMMARY:${esc(nome)}`,
      ...(String(dettagli || '').trim() ? [`DESCRIPTION:${esc(dettagli)}`] : []),
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const quando = `${DUE(d.giorno)}/${DUE(d.mese)} alle ${DUE(o.h)}:${DUE(o.min)}`;
    return { ok: true, testo: `${righe.map(piega).join('\r\n')}\r\n`, nome: nomeFile(nome), quando };
  }

  global.SN_ICS = { costruisci, nomeFile, esc, piega };
})(typeof globalThis !== 'undefined' ? globalThis : self);
