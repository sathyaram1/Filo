// La rete che toglie chi è l'utente dalle segnalazioni scritte da Filo (#1669): nome ed email dell'account, il nome che
// la memoria ricorda, gli indirizzi email. PURA: l'identità la passa chi chiama. La regola vera sta nel prompt
// (SN_CONST.SEGNALAZIONE_SENZA_PERSONA); le prove in tests/unit/segnalazioneAnonima.test.mjs.

(function (global) {
  'use strict';

  const UTENTE = 'l\'utente';
  const EMAIL_ALTRUI = '[email]';
  const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
  // Parole che un nome non è mai: «Filo» tolto da un feedback su Filo lo renderebbe illeggibile.
  const NON_NOMI = new Set(['filo', 'utente', 'l\'utente', 'lui', 'lei', 'io', 'il', 'lo', 'la', 'un', 'una', 'user']);
  // Pezzi di un cognome che da soli sono parole comuni («Della Valle» non toglie ogni «Della»).
  const PARTICELLE = new Set(['de', 'del', 'della', 'dei', 'di', 'da', 'dal', 'dalla', 'van', 'von', 'der', 'den', 'le', 'du', 'dos', 'das', 'mc', 'mac', 'st']);

  const NOME = '(\\p{Lu}[\\p{L}\'’-]*(?:[ ]\\p{Lu}[\\p{L}\'’-]*){0,2})';
  // Come la memoria scrive chi è l'utente: con lui come soggetto, mai «si chiama» di un cane o di un'azienda.
  const NEL_RICORDO = [
    new RegExp(`(?:^|[.;:!?\\n(\\]•-]\\s*|[Uu]tente\\s+)[Ss]i\\s+chiama\\s+${NOME}`, 'gu'),
    new RegExp(`[Nn]ome(?:\\s+(?:dell['’]\\s?utente|completo))?\\s*(?:è|e'|:)\\s*${NOME}`, 'gu'),
    new RegExp(`[Ee]ssere\\s+chiamat[oa]\\s+${NOME}`, 'gu'),
    new RegExp(`(?:[Ll]o|[Ll]a)\\s+(?:si\\s+)?chiam(?:a|i|ano|ino)\\s+${NOME}`, 'gu'),
    new RegExp(`[Uu]tente\\s*,\\s*${NOME}\\s*,`, 'gu'),
    new RegExp(`[Uu]tente\\s*\\(\\s*${NOME}\\s*\\)`, 'gu'),
    new RegExp(`[Uu]tente\\s+è\\s+${NOME}(?=\\s*(?:[,.;)\\n]|$))`, 'gu'),
    new RegExp(`(?:[Nn]ame\\s+is|[Ii]s\\s+called|[Gg]oes\\s+by)\\s+${NOME}`, 'gu'),
  ];

  function nomiDalRicordo(testo) {
    const trovati = new Set();
    const t = String(testo || '');
    for (const re of NEL_RICORDO) {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        const nome = m[1].trim();
        const prima = nome.split(' ')[0].toLowerCase();
        if (!NON_NOMI.has(prima) && !NON_NOMI.has(nome.toLowerCase())) trovati.add(nome);
      }
    }
    return [...trovati];
  }

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, '[\'’]').replace(/\s+/g, '\\s+');

  // Email e nome intero valgono in ogni grafia; una parola sola solo con la maiuscola e da tre lettere in su, o un
  // account «Al» toglierebbe ogni «al» del testo.
  function formeDelNome(nomi, email) {
    const forme = new Map();
    for (const e of email) forme.set(e, { testo: e, pezzo: false });
    for (const grezzo of nomi || []) {
      const nome = String(grezzo || '').replace(/\s+/g, ' ').trim();
      if (!/\p{L}/u.test(nome) || NON_NOMI.has(nome.toLowerCase())) continue;
      const pezzi = nome.split(' ');
      if (pezzi.length > 1) forme.set(nome.toLowerCase(), { testo: nome, pezzo: false });
      // Un cognome col trattino vale intero e a metà: «Núñez» da solo dice chi è quanto «Núñez-García».
      for (const p of pezzi.flatMap((x) => (x.includes('-') ? [x, ...x.split('-')] : [x]))) {
        const k = p.toLowerCase();
        if ([...p].length < 3 || PARTICELLE.has(k) || NON_NOMI.has(k) || forme.has(k)) continue;
        forme.set(k, { testo: p, pezzo: true });
      }
    }
    return [...forme.values()].sort((a, b) => b.testo.length - a.testo.length);
  }

  const PREPOSIZIONI = { a: 'all\'utente', ad: 'all\'utente', di: 'dell\'utente', da: 'dall\'utente', in: 'nell\'utente', su: 'sull\'utente', il: UTENTE, lo: UTENTE, la: UTENTE };
  const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const inizioFrase = (prima) => /(?:^|[.!?…]\s+|\n)\s*[«"“]?$/.test(prima);
  // Chi si presenta scrive il suo nome anche in minuscolo («ciao sono luca»), e lì non è mai la parola comune.
  // «sono» vale solo in apertura o dopo un saluto: «le icone sono rosa» resta un colore.
  const PRESENTAZIONE = /(?:(?:^|[^\p{L}])(?:mi\s+chiamo|io\s+sono|chiamami|my\s+name\s+is|i\s+am|i['’]m)|(?:^|[.!?…\n«"“(]|(?:^|[^\p{L}])(?:ciao|salve|buongiorno|buonasera|hey|hi|hello)[\s,!]*)\s*(?:sono|son))\s+$/iu;

  function ricuci(t) {
    return t
      .replace(/([Ll]['’]utente)\s*\(\s*(?:l'utente|\[email\])\s*\)/g, '$1')
      .replace(/([Ll]['’]utente)\s*,\s*l'utente\s*,\s*/g, '$1 ')
      .replace(/([Ll]['’]utente)\s+l'utente(?![\p{L}\p{N}])/gu, '$1');
  }

  function ripulisci(testo, identita) {
    let t = String(testo ?? '');
    if (!t) return t;
    const { nomi = [], email = [] } = identita || {};
    const proprie = new Set((email || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
    t = t.replace(EMAIL, (m) => (proprie.has(m.toLowerCase()) ? m : EMAIL_ALTRUI));
    for (const forma of formeDelNome(nomi, proprie)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}'’])(?:([Aa]d?|[Dd][ai]|[Ii][nl]|[Ss]u|[Ll][ao])\\s+)?(${esc(forma.testo)})(?![\\p{L}\\p{N}])`, 'giu');
      t = t.replace(re, (intero, prep, nome, pos, tutto) => {
        // Dentro un percorso la cartella personale porta il nome anche in minuscolo («/Users/giulia/»), e lì non è
        // mai una parola comune.
        if (!prep && /[\\/]/.test(tutto.charAt(pos - 1))) return 'utente';
        if (forma.pezzo && !/^\p{Lu}/u.test(nome) && (prep || !PRESENTAZIONE.test(tutto.slice(0, pos)))) return intero;
        if (prep) {
          const al = PREPOSIZIONI[prep.toLowerCase()];
          return /^\p{Lu}/u.test(prep) ? maiuscola(al) : al;
        }
        return inizioFrase(tutto.slice(0, pos)) ? maiuscola(UTENTE) : UTENTE;
      });
    }
    return ricuci(t);
  }

  global.SN_SEGNALAZIONE_ANONIMA = { ripulisci, nomiDalRicordo };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_SEGNALAZIONE_ANONIMA;
}
