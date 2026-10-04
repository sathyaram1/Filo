// Le pagine delicate (#1004): posta, banche, sanità, i siti che aggiunge l'utente e quelli che hanno mostrato un campo
// password o carta. Di queste i lavori automatici non mandano testo a nessun modello. Logica pura: la memoria dei
// campi visti la tiene src/main/services/pagineDelicate.js; prove in tests/unit/pagineDelicate.test.mjs.

(function (global) {
  'use strict';

  // L'elenco di serie: la configurazione remota (sitiDelicati in config/models) sostituisce una categoria per intero,
  // e può aggiungerne di nuove. Un dominio vale anche per i suoi sottodomini.
  const PREDEFINITI = {
    posta: [
      'mail.google.com', 'inbox.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
      'outlook.cloud.microsoft', 'mail.yahoo.com', 'mail.aol.com', 'mail.proton.me', 'mail.protonmail.com',
      'icloud.com', 'app.tuta.com', 'mail.tutanota.com', 'fastmail.com', 'mail.zoho.com', 'mail.zoho.eu',
      'mail.yandex.com', 'mail.yandex.ru', 'e.mail.ru', 'navigator.gmx.net', 'navigator.gmx.com', 'navigator.web.de',
      'posteo.de', 'mailbox.org', 'hey.com', 'mail.libero.it', 'mail1.libero.it', 'mail.virgilio.it',
      'mail1.virgilio.it', 'mail.tiscali.it', 'webmail.tiscali.it', 'mail.tim.it', 'webmail.aruba.it', 'webmail.pec.it',
      'webmail.register.it', 'legalmail.infocert.it', 'email.it',
    ],
    banche: [
      'intesasanpaolo.com', 'isybank.com', 'unicredit.it', 'bancobpm.it', 'webank.it', 'bper.it', 'mps.it', 'credem.it',
      'bnl.it', 'ing.it', 'finecobank.com', 'bancamediolanum.it', 'chebanca.it', 'mediobancapremier.com', 'widiba.it',
      'hype.it', 'poste.it', 'postepay.it', 'bancasella.it', 'sella.it', 'credit-agricole.it', 'deutsche-bank.it',
      'bancaetica.it', 'bancagenerali.it', 'allianzbank.it', 'popso.it', 'bancaifis.it', 'illimity.com', 'inbank.it',
      'relaxbanking.it', 'nexi.it', 'americanexpress.com', 'paypal.com', 'satispay.com', 'revolut.com', 'n26.com',
      'wise.com', 'bunq.com', 'directa.it', 'degiro.it', 'degiro.com', 'traderepublic.com', 'scalable.capital',
      'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com', 'usbank.com', 'hsbc.com',
      'hsbc.co.uk', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com', 'santander.com', 'santander.co.uk', 'bbva.es',
      'caixabank.es', 'bnpparibas', 'societegenerale.fr', 'credit-agricole.fr', 'labanquepostale.fr',
      'deutsche-bank.de', 'commerzbank.de', 'sparkasse.de', 'ing.de', 'comdirect.de', 'dkb.de', 'ing.es', 'ing.nl',
      'abnamro.nl', 'rabobank.nl', 'ubs.com', 'postfinance.ch',
    ],
    sanita: [
      'fascicolosanitario.gov.it', 'fascicolo-sanitario.it', 'sanita.finanze.it',
      'fascicolosanitario.regione.lombardia.it', 'salutelazio.it', 'synlab.it', 'cdi.it', 'lifebrain.it',
      'miodottore.it', 'idoctors.it', 'doctolib.it', 'doctolib.fr', 'doctolib.de', 'mychart.com',
      'nhsapp.service.nhs.uk', 'patientaccess.com', 'unisalute.it',
    ],
  };

  // Come si chiama il motivo in una riga per un modello o per l'utente.
  const NOMI = { posta: 'posta', banche: 'banca', sanita: 'sanità', campi: 'password o carta', utente: 'scelta da te' };

  // L'host di un indirizzo web, come si confronta con gli elenchi: minuscolo, senza «www.» e senza punto finale.
  function host(url) {
    let u = null;
    try { u = new URL(String(url == null ? '' : url)); } catch (_) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  }

  function pulisci(lista) {
    if (!Array.isArray(lista)) return [];
    const out = [];
    for (const x of lista) {
      if (typeof x !== 'string') continue;
      const d = x.trim().toLowerCase().replace(/^\*?\.+/, '').replace(/\.+$/, '').replace(/^www\./, '');
      if (d && !out.includes(d)) out.push(d);
    }
    return out;
  }

  function dentro(h, lista) {
    return lista.some((d) => h === d || h.endsWith(`.${d}`));
  }

  // Le categorie in uso: quelle di serie, con sopra quelle della configurazione remota (ognuna sostituisce la sua).
  function elenco(remoto) {
    const out = {};
    for (const [k, v] of Object.entries(PREDEFINITI)) out[k] = v.slice();
    if (remoto && typeof remoto === 'object' && !Array.isArray(remoto)) {
      for (const [k, v] of Object.entries(remoto)) if (Array.isArray(v)) out[k] = pulisci(v);
    }
    return out;
  }

  function attivo(settings) {
    const p = settings && settings.security && settings.security.pagineDelicate;
    return !(p && p.enabled === false);
  }

  function sitiUtente(settings) {
    const p = settings && settings.security && settings.security.pagineDelicate;
    return pulisci(p && p.siti);
  }

  // Il motivo per cui una pagina è delicata ('utente', una categoria dell'elenco, 'campi'), o null. `campi(host)` dice se
  // il sito ha mostrato un campo password o carta.
  function classifica(url, { attivo: acceso = true, sitiUtente: propri = [], elenco: categorie = PREDEFINITI, campi = null } = {}) {
    if (!acceso) return null;
    const h = host(url);
    if (!h) return null;
    if (dentro(h, pulisci(propri))) return 'utente';
    for (const [k, lista] of Object.entries(categorie || {})) {
      if (Array.isArray(lista) && dentro(h, lista)) return k;
    }
    if (typeof campi === 'function' && campi(h)) return 'campi';
    return null;
  }

  const piano = (t) => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // «Questo sito», «questa pagina», «scheda: <titolo>» in un elenco di siti detto a parole: la chat vede i titoli delle
  // schede, non gli indirizzi. `schede` [{url, title}], `attiva` l'indirizzo della scheda web davanti.
  // Torna { valore } coi siti al posto dei riferimenti, o { rifiuto } se un riferimento non porta a un sito solo.
  function risolviSchede(valore, { schede = [], attiva = '' } = {}) {
    let testo = String(valore == null ? '' : valore);
    const web = (Array.isArray(schede) ? schede : []).filter((t) => t && host(t.url));
    let rifiuto = null;
    const perTitolo = (detto) => {
      const ago = piano(detto);
      if (!ago) { rifiuto = rifiuto || 'manca il titolo della scheda'; return ''; }
      const siti = [...new Set(web.filter((t) => {
        const tit = piano(t.title);
        return tit && (tit.includes(ago) || (tit.length >= 4 && ago.includes(tit)));
      }).map((t) => host(t.url)))];
      if (siti.length === 1) return siti[0];
      rifiuto = rifiuto || (siti.length
        ? `«${detto.trim()}» è il titolo di più schede (${siti.join(', ')}): scrivi il sito`
        : `nessuna scheda aperta ha per titolo «${detto.trim()}»`);
      return '';
    };
    testo = testo.replace(/\b(?:(?:la|della|nella)\s+)?scheda\s*:?\s*[«"“]([^»"”]*)[»"”]/gi, (_m, t) => perTitolo(t));
    testo = testo.replace(/\b(?:(?:la|della|nella)\s+)?scheda\s*:\s*([^,;\n]*)/gi, (_m, t) => perTitolo(t));
    testo = testo.replace(/\b(questo sito|questa pagina|questa scheda|la pagina aperta|il sito aperto)\b/gi, () => {
      const h = host(attiva);
      if (!h) rifiuto = rifiuto || 'non c\'è una pagina web aperta';
      return h;
    });
    return rifiuto ? { rifiuto } : { valore: testo };
  }

  function nome(motivo) {
    return NOMI[motivo] || String(motivo || '');
  }

  global.SN_PAGINE_DELICATE = { PREDEFINITI, host, elenco, attivo, sitiUtente, classifica, nome, risolviSchede };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_PAGINE_DELICATE;
})(typeof globalThis !== 'undefined' ? globalThis : self);
