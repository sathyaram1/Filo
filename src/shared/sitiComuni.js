// Siti comuni che il modello può scrivere a memoria (#553): la home, la ricerca interna e, dove una pagina si chiama
// con le parole che cerca (una voce di Wikipedia), quella pagina. Non è un elenco di siti fidati: le parole scritte dal
// modello passano lo stesso controllo della ricerca sul web. Prove: tests/unit/sitiComuni.test.mjs.

(function (global) {
  'use strict';

  // `cerca`: «{q}» nel parametro o in un pezzo del percorso. `host`: espressione sul nome intero, minuscolo.
  // `pagine`: percorsi la cui coda sono parole (si confrontano come la ricerca).
  const SITI = Object.freeze([
    { nome: 'Google', host: /^(?:www\.)?google\.(?:it|com)$/, home: 'https://www.google.it/', cerca: 'https://www.google.it/search?q={q}' },
    { nome: 'Google Maps', host: /^(?:www\.)?google\.(?:it|com)$/, home: 'https://www.google.com/maps', cerca: 'https://www.google.com/maps/search/{q}' },
    { nome: 'Amazon', host: /^(?:www\.)?amazon\.it$/, home: 'https://www.amazon.it/', cerca: 'https://www.amazon.it/s?k={q}' },
    { nome: 'YouTube', host: /^(?:www\.|m\.)?youtube\.com$/, home: 'https://www.youtube.com/', cerca: 'https://www.youtube.com/results?search_query={q}' },
    {
      nome: 'Wikipedia', host: /^(?:(?:[a-z]{2,3}|simple)\.)?(?:m\.)?wikipedia\.org$/, home: 'https://it.wikipedia.org/',
      cerca: 'https://it.wikipedia.org/w/index.php?search={q}', pagine: [/^\/wiki\/([^/?#]+)$/],
      esempio: 'https://it.wikipedia.org/wiki/<Titolo_della_voce> (o en., de., …)',
    },
    { nome: 'eBay', host: /^(?:www\.)?ebay\.it$/, home: 'https://www.ebay.it/', cerca: 'https://www.ebay.it/sch/i.html?_nkw={q}' },
    { nome: 'Subito', host: /^(?:www\.)?subito\.it$/, home: 'https://www.subito.it/', cerca: 'https://www.subito.it/annunci-italia/vendita/usato/?q={q}' },
    { nome: 'Zalando', host: /^(?:www\.)?zalando\.it$/, home: 'https://www.zalando.it/', cerca: 'https://www.zalando.it/catalogo/?q={q}' },
    { nome: 'IKEA', host: /^(?:www\.)?ikea\.com$/, home: 'https://www.ikea.com/it/it/', cerca: 'https://www.ikea.com/it/it/search/?q={q}' },
    { nome: 'AliExpress', host: /^(?:www\.|it\.)?aliexpress\.com$/, home: 'https://www.aliexpress.com/', cerca: 'https://www.aliexpress.com/wholesale?SearchText={q}' },
    { nome: 'MediaWorld', host: /^(?:www\.)?mediaworld\.it$/, home: 'https://www.mediaworld.it/', cerca: 'https://www.mediaworld.it/it/search.html?query={q}' },
    { nome: 'TripAdvisor', host: /^(?:www\.)?tripadvisor\.it$/, home: 'https://www.tripadvisor.it/', cerca: 'https://www.tripadvisor.it/Search?q={q}' },
    { nome: 'Booking', host: /^(?:www\.)?booking\.com$/, home: 'https://www.booking.com/', cerca: 'https://www.booking.com/searchresults.it.html?ss={q}' },
    { nome: 'GialloZafferano', host: /^(?:www\.)?giallozafferano\.it$/, home: 'https://www.giallozafferano.it/', cerca: 'https://www.giallozafferano.it/ricerca-ricette/{q}/' },
    { nome: 'IMDb', host: /^(?:www\.|m\.)?imdb\.com$/, home: 'https://www.imdb.com/', cerca: 'https://www.imdb.com/find/?q={q}' },
    { nome: 'Spotify', host: /^open\.spotify\.com$/, home: 'https://open.spotify.com/', cerca: 'https://open.spotify.com/search/{q}' },
    { nome: 'Netflix', host: /^(?:www\.)?netflix\.com$/, home: 'https://www.netflix.com/', cerca: 'https://www.netflix.com/search?q={q}' },
    { nome: 'Reddit', host: /^(?:www\.|old\.)?reddit\.com$/, home: 'https://www.reddit.com/', cerca: 'https://www.reddit.com/search/?q={q}' },
    { nome: 'GitHub', host: /^github\.com$/, home: 'https://github.com/', cerca: 'https://github.com/search?q={q}' },
    { nome: 'Stack Overflow', host: /^stackoverflow\.com$/, home: 'https://stackoverflow.com/', cerca: 'https://stackoverflow.com/search?q={q}' },
    {
      nome: 'MDN', host: /^developer\.mozilla\.org$/, home: 'https://developer.mozilla.org/it/', cerca: 'https://developer.mozilla.org/en-US/search?q={q}',
      pagine: [/^\/[a-z]{2}(?:-[A-Za-z]{2})?\/docs\/((?:[A-Za-z0-9_.:@%-]+\/)*[A-Za-z0-9_.:@%()-]+)$/],
      esempio: 'https://developer.mozilla.org/en-US/docs/Web/API/<Nome>',
    },
    { nome: 'Il Meteo', host: /^(?:www\.)?ilmeteo\.it$/, home: 'https://www.ilmeteo.it/', cerca: 'https://www.ilmeteo.it/meteo/{q}' },
    { nome: '3B Meteo', host: /^(?:www\.)?3bmeteo\.com$/, home: 'https://www.3bmeteo.com/', cerca: 'https://www.3bmeteo.com/meteo/{q}' },
    { nome: 'Gmail', host: /^mail\.google\.com$/, home: 'https://mail.google.com/' },
    { nome: 'Google Drive', host: /^drive\.google\.com$/, home: 'https://drive.google.com/' },
    { nome: 'Google Calendar', host: /^calendar\.google\.com$/, home: 'https://calendar.google.com/' },
    { nome: 'Outlook', host: /^outlook\.live\.com$/, home: 'https://outlook.live.com/' },
    { nome: 'WhatsApp Web', host: /^web\.whatsapp\.com$/, home: 'https://web.whatsapp.com/' },
    { nome: 'Facebook', host: /^(?:www\.|m\.)?facebook\.com$/, home: 'https://www.facebook.com/' },
    { nome: 'Instagram', host: /^(?:www\.)?instagram\.com$/, home: 'https://www.instagram.com/' },
    { nome: 'LinkedIn', host: /^(?:www\.)?linkedin\.com$/, home: 'https://www.linkedin.com/' },
    { nome: 'X', host: /^(?:www\.)?(?:x|twitter)\.com$/, home: 'https://x.com/' },
    { nome: 'Corriere della Sera', host: /^(?:www\.)?corriere\.it$/, home: 'https://www.corriere.it/' },
    { nome: 'la Repubblica', host: /^(?:www\.)?repubblica\.it$/, home: 'https://www.repubblica.it/' },
    { nome: 'ANSA', host: /^(?:www\.)?ansa\.it$/, home: 'https://www.ansa.it/' },
    { nome: 'Il Sole 24 Ore', host: /^(?:www\.)?ilsole24ore\.com$/, home: 'https://www.ilsole24ore.com/' },
    { nome: 'Gazzetta dello Sport', host: /^(?:www\.)?gazzetta\.it$/, home: 'https://www.gazzetta.it/' },
    { nome: 'Trenitalia', host: /^(?:www\.)?trenitalia\.com$/, home: 'https://www.trenitalia.com/' },
    { nome: 'Italo', host: /^(?:www\.)?italotreno\.(?:it|com)$/, home: 'https://www.italotreno.com/' },
    { nome: 'Poste Italiane', host: /^(?:www\.)?poste\.it$/, home: 'https://www.poste.it/' },
    { nome: 'INPS', host: /^(?:www\.)?inps\.it$/, home: 'https://www.inps.it/' },
    { nome: 'Agenzia delle Entrate', host: /^(?:www\.)?agenziaentrate\.gov\.it$/, home: 'https://www.agenziaentrate.gov.it/' },
    { nome: 'Immobiliare.it', host: /^(?:www\.)?immobiliare\.it$/, home: 'https://www.immobiliare.it/' },
    { nome: 'Idealista', host: /^(?:www\.)?idealista\.it$/, home: 'https://www.idealista.it/' },
    { nome: 'Treccani', host: /^(?:www\.)?treccani\.it$/, home: 'https://www.treccani.it/' },
  ].map((s) => Object.freeze(s)));

  function analizza(url) {
    let u = null;
    try { u = new URL(String(url || '').trim()); } catch (_) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || u.port) return null;
    return u;
  }

  function decodifica(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (_) { return ''; }
  }

  const percorsoHome = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';

  // Il modello della ricerca: dove stanno le parole e cosa deve restare uguale.
  function modello(sito) {
    if (!sito.cerca) return null;
    const m = analizza(sito.cerca.replace('{q}', 'QQQ'));
    if (!m) return null;
    const parametro = [...m.searchParams.entries()].find(([, v]) => v === 'QQQ');
    if (parametro) return { percorso: m.pathname, parametro: parametro[0] };
    const i = m.pathname.indexOf('QQQ');
    return i >= 0 ? { prima: m.pathname.slice(0, i), dopo: m.pathname.slice(i + 3) } : null;
  }

  // { sito, tipo: 'home'|'cerca'|'pagina', parole } per un indirizzo costruito dall'elenco, se no null.
  // Il frammento resta fuori: la pagina aperta lo legge, quindi porterebbe parole non controllate.
  function riconosci(url) {
    const u = analizza(url);
    if (!u || u.hash) return null;
    const host = u.hostname.toLowerCase();
    for (const sito of SITI) {
      if (!sito.host.test(host)) continue;
      const h = analizza(sito.home);
      if (h && !u.search && percorsoHome(u.pathname) === percorsoHome(h.pathname)) return { sito: sito.nome, tipo: 'home', parole: '' };
      if (!u.search && u.pathname === '/') return { sito: sito.nome, tipo: 'home', parole: '' };
      const m = modello(sito);
      if (m && m.parametro) {
        const chiavi = [...u.searchParams.keys()];
        if (u.pathname === m.percorso && chiavi.length === 1 && chiavi[0] === m.parametro) {
          return { sito: sito.nome, tipo: 'cerca', parole: u.searchParams.get(m.parametro) || '' };
        }
      } else if (m && !u.search && u.pathname.startsWith(m.prima) && u.pathname.endsWith(m.dopo)) {
        const pezzo = u.pathname.slice(m.prima.length, u.pathname.length - m.dopo.length);
        if (pezzo && !pezzo.includes('/')) return { sito: sito.nome, tipo: 'cerca', parole: decodifica(pezzo) };
      }
      for (const re of sito.pagine || []) {
        const p = u.search ? null : u.pathname.match(re);
        if (p) return { sito: sito.nome, tipo: 'pagina', parole: decodifica(p[1]).replace(/[_/]+/g, ' ').trim() };
      }
    }
    return null;
  }

  // L'indirizzo della ricerca interna di un sito dell'elenco, se l'elenco la conosce.
  function costruisci(url, parole) {
    const u = analizza(url);
    const q = String(parole || '').replace(/\s+/g, ' ').trim();
    if (!u || !q) return '';
    const sito = SITI.find((s) => s.cerca && s.host.test(u.hostname.toLowerCase()));
    if (!sito) return '';
    return sito.cerca.replace('{q}', encodeURIComponent(q));
  }

  // Le righe per il modello: quello che può scrivere a memoria.
  function perModello() {
    return SITI.map((s) => {
      const parti = [`home ${s.home}`];
      if (s.cerca) parti.push(`ricerca ${s.cerca.replace('{q}', '…')}`);
      if (s.esempio) parti.push(`voce ${s.esempio}`);
      return `${s.nome}: ${parti.join(', ')}`;
    }).join('; ');
  }

  global.SN_SITI_COMUNI = Object.freeze({ SITI, riconosci, costruisci, perModello });
})(typeof globalThis !== 'undefined' ? globalThis : self);
