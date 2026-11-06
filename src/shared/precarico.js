// Il precarico dei link (#1985): quali link si precaricano, con quali tetti e tempi, e quando il livello dei link a
// schermo si ferma. Logica pura, per il content script (src/content/precarico.js) e per il main; il DOM sta lì.
// Regole: tests/unit/precarico.test.mjs.

(function (global) {
  'use strict';

  const LIMITI = Object.freeze({
    // Il fermo del mouse sul link prima di partire, come instant.page: sotto, un passaggio di traverso non conta.
    ATTESA_PASSAGGIO_MS: 65,
    // Link a schermo precaricati per pagina; oltre, i link restanti partono al passaggio del mouse.
    TETTO_VISIBILI: 20,
    // Link passati col mouse tenuti in lista: Chromium ne accetta 50 per pagina, e coi 20 a schermo ne restano 30.
    PASSAGGI_TENUTI: 30,
    // Fra un link a schermo e il successivo: con le pagine che rispondono sotto il secondo ne restano in corso uno o due.
    PASSO_MS: 700,
    // La rete è ferma quando nessuna risorsa della pagina è finita da almeno questo tempo.
    RETE_FERMA_MS: 500,
    // Con uno scaricamento in corso o senza la spina, ogni quanto si richiede al main se si può ripartire.
    RIPROVA_PERMESSO_MS: 5000,
  });

  // Percorsi che fanno qualcosa invece di mostrare una pagina: uscire, cancellare, disiscriversi. Una parola intera
  // del percorso, così «removed-items» resta una pagina e «user/delete-account» no.
  const AZIONI = /(?:^|[^a-z0-9])(?:(?:log|sign|opt)[-_]?(?:out|off)|delete|remove|unsubscribe|unsub|deactivate|disconnect|destroy|cancel|esci|disconnetti|elimina|cancella|rimuovi|disiscriviti|disiscrizione)(?:[^a-z0-9]|$)/i;
  // Un file non è una pagina: precaricarlo scaricherebbe megabyte che nessuno ha chiesto.
  const FILE = /\.(?:pdf|zip|rar|7z|gz|tgz|bz2|xz|tar|exe|msi|dmg|pkg|deb|rpm|apk|appimage|iso|img|bin|jar|torrent|mp3|m4a|wav|flac|ogg|mp4|m4v|mkv|mov|avi|webm|docx?|xlsx?|pptx?|odt|ods|odp|csv|jpe?g|png|gif|webp|avif|svg)$/i;

  function leggi(url) {
    try { return new URL(String(url)); } catch (_) { return null; }
  }

  // Stesso sito con lo schema: verso un altro sito il precarico parte senza cookie, sprecato sulle pagine con l'accesso.
  function stessoSito(a, b) {
    if (a.protocol !== b.protocol) return false;
    const S = global.SN_STESSO_SITO;
    if (S && typeof S.stessoSito === 'function') return S.stessoSito(a.href, b.href);
    return a.hostname === b.hostname;
  }

  // Il link si apre nella scheda della pagina: un precarico serve solo lì, Chromium non lo passa a un'altra scheda.
  function apreQui(target) {
    const t = String(target || '').trim().toLowerCase();
    return !t || t === '_self' || t === '_top' || t === '_parent';
  }

  function senzaFrammento(u) {
    return u.href.slice(0, u.href.length - u.hash.length);
  }

  // Il motivo per cui un link non si precarica, '' se si può. `link`: { href, rel, download, target }; `pagina`:
  // l'indirizzo della pagina che lo contiene.
  function motivoEscluso(link, pagina) {
    const l = link || {};
    const raw = String(l.href || '');
    const u = leggi(raw);
    const p = leggi(pagina);
    if (!u || !p) return 'indirizzo';
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'schema';
    if (u.username || u.password) return 'credenziali';
    if (raw.includes('?')) return 'query';
    if (senzaFrammento(u) === senzaFrammento(p)) return 'stessa-pagina';
    if (!stessoSito(u, p)) return 'altro-sito';
    if (/(?:^|\s)nofollow(?:\s|$)/i.test(String(l.rel || ''))) return 'nofollow';
    if (l.download) return 'download';
    if (!apreQui(l.target)) return 'altra-scheda';
    let percorso = u.pathname;
    try { percorso = decodeURIComponent(percorso); } catch (_) {}
    if (AZIONI.test(percorso)) return 'azione';
    if (FILE.test(percorso)) return 'file';
    return '';
  }

  // L'indirizzo da dare a Chromium: senza il frammento, che al server non arriva.
  function indirizzoDaPrecaricare(href) {
    const u = leggi(href);
    return u ? senzaFrammento(u) : '';
  }

  // Connessione a consumo o lenta: niente link a schermo.
  function reteARisparmio(conn) {
    if (!conn) return false;
    return conn.saveData === true || /^(?:slow-2g|2g|3g)$/.test(String(conn.effectiveType || ''));
  }

  // L'interruttore del livello dei link a schermo, acceso di serie.
  function visibiliAcceso(impostazioni) {
    const p = impostazioni && impostazioni.precarico;
    return !(p && p.visibili === false);
  }

  // Perché il main ferma i link a schermo adesso, '' se possono partire.
  function motivoFermoVisibili({ impostazioni, incognito = false, scaricando = false, aBatteria = false } = {}) {
    if (!visibiliAcceso(impostazioni)) return 'spento';
    if (incognito) return 'incognito';
    if (scaricando) return 'scaricamento';
    if (aBatteria) return 'batteria';
    return '';
  }

  // Il prossimo link a schermo da precaricare: il più in alto, poi il più a sinistra. `candidati`: [{ url, top, left }].
  function prossimo(candidati, giaFatti) {
    let meglio = null;
    for (const c of candidati || []) {
      if (!c || !c.url || (giaFatti && giaFatti.has(c.url))) continue;
      if (!meglio || c.top < meglio.top || (c.top === meglio.top && c.left < meglio.left)) meglio = c;
    }
    return meglio;
  }

  const api = Object.freeze({
    LIMITI, motivoEscluso, apreQui, indirizzoDaPrecaricare, reteARisparmio, visibiliAcceso, motivoFermoVisibili, prossimo,
  });
  global.SN_PRECARICO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
