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
    // Fra un link a schermo e il successivo, al minimo; su un sito lento il passo si allunga (passoVisibili).
    PASSO_MS: 700,
    // Precarichi dei link a schermo in corso insieme: la pagina non vede quelli di Chromium, il passo li stima.
    IN_CORSO_MAX: 2,
    // Il passo più lungo: un sito lentissimo non ferma del tutto i link a schermo.
    PASSO_MAX_MS: 10000,
    // La rete è ferma quando nessuna risorsa della pagina è finita da almeno questo tempo.
    RETE_FERMA_MS: 500,
    // Con uno scaricamento in corso o senza la spina, ogni quanto si richiede al main se si può ripartire.
    RIPROVA_PERMESSO_MS: 5000,
    // Dopo un clic che non ha portato via la pagina (un file scaricato, una risposta vuota) i link a schermo ripartono.
    RIPRESA_DOPO_CLIC_MS: 8000,
    // Di ogni pezzo del testo di un link (testo, etichetta, titolo, classe) basta l'inizio: una scheda intera dentro un
    // link non dice di più.
    TESTO_LINK: 200,
  });

  // Le parole d'azione stanno con l'avviso sui link sospetti (src/shared/linkSospetto.js), in un elenco solo.
  function paroleAzione() {
    if (!global.SN_LINK_SOSPETTO && typeof require === 'function') { try { require('./linkSospetto.js'); } catch (_) {} }
    const L = global.SN_LINK_SOSPETTO;
    return L && Array.isArray(L.PAROLE_AZIONE) ? L.PAROLE_AZIONE : null;
  }

  // In ogni alfabeto: un testo in cirillico o in giapponese non deve sparire prima del confronto.
  function normalizza(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
  }
  function parole(s) {
    return normalizza(s).replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  let elencoVisto = null;
  let elencoNormale = [];
  function normali(elenco) {
    if (elenco !== elencoVisto) {
      elencoVisto = elenco;
      elencoNormale = elenco.map((w) => {
        const n = normalizza(w).toLowerCase();
        // Le scritture senza spazi fra le parole (giapponese, cinese) e quelle non latine si cercano anche dentro.
        return { w: n, dentro: n.length >= 5 || /[^\x00-\x7f]/.test(n) };
      });
    }
    return elencoNormale;
  }

  // Precaricare un link d'uscita fa uscire dal sito: meglio perdere il precarico di una pagina che l'accesso. Una
  // parola d'azione vale anche dentro una composta («doLogout», «deleteAccount») e scritta in due («log out»).
  function faAzione(testo, elenco) {
    const p = parole(testo);
    const voci = normali(elenco);
    for (let i = 0; i < p.length; i++) {
      const due = i + 1 < p.length ? p[i] + p[i + 1] : '';
      for (const { w, dentro } of voci) {
        if (p[i] === w || due === w || (dentro && p[i].includes(w))) return true;
      }
    }
    return false;
  }
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

  // Il motivo per cui un link non si precarica, '' se si può. `link`: { href, rel, download, target, testo }, con
  // `testo` quello che il link dice a chi lo guarda (testo, etichetta, titolo); `pagina`: l'indirizzo che lo contiene.
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
    const azioni = paroleAzione();
    if (!azioni || faAzione(percorso, azioni) || faAzione(String(l.testo || '').slice(0, LIMITI.TESTO_LINK * 5), azioni)) return 'azione';
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
  // `dietro`: la scheda non è quella davanti, o la finestra è ridotta. Per la pagina resta «visibile» lo stesso.
  function motivoFermoVisibili({ impostazioni, incognito = false, scaricando = false, aBatteria = false, dietro = false } = {}) {
    if (!visibiliAcceso(impostazioni)) return 'spento';
    if (incognito) return 'incognito';
    if (dietro) return 'dietro';
    if (scaricando) return 'scaricamento';
    if (aBatteria) return 'batteria';
    return '';
  }

  // Il passo fra due link a schermo: un precarico dura circa quanto è durata la pagina stessa, e ogni durata/2 ne
  // tiene in corso al più due. `durataPagina`: ms dalla richiesta della pagina all'ultimo byte.
  function passoVisibili(durataPagina) {
    const d = Number(durataPagina);
    const stima = Number.isFinite(d) && d > 0 ? Math.ceil(d / LIMITI.IN_CORSO_MAX) : 0;
    return Math.min(LIMITI.PASSO_MAX_MS, Math.max(LIMITI.PASSO_MS, stima));
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
