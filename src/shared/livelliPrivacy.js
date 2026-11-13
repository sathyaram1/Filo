// I livelli di privacy (#1589): quanto Filo manda ai modelli dalle pagine senza che tu lo chieda, come DATI, e l'unica
// funzione che li applica. Nessuna funzione che manda fuori decide da sé: chiede a `chiede` (nel main, SN_DELICATE.filtro).
// Cosa una pagina è lo dice pagineDelicate.js; cosa non esce mai, a nessun livello, pavimento.js. Prove: tests/unit/livelliPrivacy.test.mjs.

(function (global) {
  'use strict';

  // Dal più largo al più stretto: alzare quanto esce vuol dire risalire questo elenco.
  const LIVELLI = Object.freeze([
    Object.freeze({ id: 'anticipo', nome: 'Tutto in anticipo' }),
    Object.freeze({ id: 'delicate', nome: 'Chiedi sulle delicate' }),
    Object.freeze({ id: 'sempre', nome: 'Chiedi sempre' }),
  ]);
  const ORDINE = LIVELLI.map((l) => l.id);

  // Le categorie su cui «Tutto in anticipo» può comunque chiedere. La sanità chiede di serie finché un legale non dice il
  // contrario: i dati sanitari sono una categoria speciale del GDPR (decisione D-72).
  const CATEGORIE = Object.freeze(['posta', 'banche', 'sanita', 'pa', 'campi']);
  const PREDEFINITA = Object.freeze({ livello: 'anticipo', incognito: 'sempre', chiedi: Object.freeze(['sanita']), sitiAnticipo: Object.freeze([]) });

  const NOMI_CATEGORIE = Object.freeze({
    posta: 'posta', banche: 'banca', sanita: 'sanità', pa: 'enti pubblici', campi: 'pagine con una password',
  });
  const SU = Object.freeze({
    posta: 'sulla posta', banche: 'sulla banca', sanita: 'sulla sanità', pa: 'sugli enti pubblici', campi: 'sulle pagine con una password',
  });

  const livelloValido = (v, ripiego) => (ORDINE.includes(v) ? v : ripiego);

  function pulisciSiti(lista) {
    if (!Array.isArray(lista)) return [];
    const out = [];
    for (const x of lista) {
      if (typeof x !== 'string') continue;
      const d = x.trim().toLowerCase().replace(/^\*?\.+/, '').replace(/\.+$/, '').replace(/^www\./, '');
      if (d && !out.includes(d)) out.push(d);
    }
    return out;
  }

  // La regola in vigore, da impostazioni qualunque (assenti, vecchie, manomesse): mai un throw.
  function regola(settings) {
    const sec = settings && typeof settings === 'object' ? settings.security : null;
    const p = sec && typeof sec === 'object' && sec.privacy && typeof sec.privacy === 'object' ? sec.privacy : {};
    const del = sec && typeof sec === 'object' && sec.pagineDelicate && typeof sec.pagineDelicate === 'object' ? sec.pagineDelicate : {};
    const chiedi = Array.isArray(p.chiedi)
      ? CATEGORIE.filter((c) => p.chiedi.includes(c))
      : PREDEFINITA.chiedi.slice();
    return {
      livello: livelloValido(p.livello, PREDEFINITA.livello),
      incognito: livelloValido(p.incognito, PREDEFINITA.incognito),
      chiedi,
      sitiAnticipo: pulisciSiti(p.sitiAnticipo),
      // I siti delicati aggiunti dall'utente sono la sua eccezione «chiedi»: lì chiede a ogni livello.
      sitiChiedi: pulisciSiti(del.siti),
    };
  }

  const dentro = (h, lista) => Boolean(h) && lista.some((d) => h === d || h.endsWith(`.${d}`));

  // Il motivo per cui da questa pagina non parte niente da solo (e Filo chiede), o null se parte. `motivo` è quello che la
  // pagina è (pagineDelicate.classifica: 'utente', una categoria, 'campi'), `campi` se la pagina mostra un campo password
  // o carta, `tipo` 'testo' o 'immagine'. Solo pagine web: `host` vuoto (pagine di Filo, file locali) non chiede.
  function chiede(r, { host = '', motivo = null, campi = false, incognito = false, tipo = 'testo' } = {}) {
    if (!host) return null;
    // Il pavimento: da una pagina che mostra un campo password o carta nessuna immagine parte da sola, a nessun livello.
    if (tipo === 'immagine' && campi) return 'campi';
    if (motivo === 'utente' || dentro(host, r.sitiChiedi)) return 'utente';
    if (!incognito && dentro(host, r.sitiAnticipo)) return null;
    const livello = incognito ? r.incognito : r.livello;
    if (livello === 'sempre') return motivo || (incognito ? 'incognito' : 'sempre');
    if (!motivo) return null;
    return livello === 'delicate' || r.chiedi.includes(motivo) ? motivo : null;
  }

  // ── Alzare o abbassare ───────────────────────────────────────────────────────
  // Alzare quanto esce (un livello più largo, una categoria che smette di chiedere, un sito in anticipo in più) vuole la
  // parola «conferma» scritta, da qualunque strada arrivi; abbassarlo no.
  const rango = (v) => { const i = ORDINE.indexOf(v); return i < 0 ? ORDINE.length : i; };
  function alza(prima, dopo) {
    const a = regola({ security: { privacy: prima } });
    const b = regola({ security: { privacy: { ...prima, ...dopo } } });
    if (rango(b.livello) < rango(a.livello) || rango(b.incognito) < rango(a.incognito)) return true;
    if (a.chiedi.some((c) => !b.chiedi.includes(c))) return true;
    return b.sitiAnticipo.some((s) => !a.sitiAnticipo.includes(s));
  }

  // Lo stesso confronto su due impostazioni intere: conta anche un sito tolto da quelli dove Filo chiede sempre o uno in
  // più fra i segnati per il campo password che per te non sono delicati. È la domanda di chi scrive per altre strade
  // (l'annullo di un cambio, il ripristino, un backup): da qualunque strada, alzare vuole «conferma».
  function alzaTutto(primaSettings, dopoSettings) {
    const sec = (s) => (s && typeof s === 'object' && s.security && typeof s.security === 'object' ? s.security : {});
    const p = (s) => (sec(s).privacy && typeof sec(s).privacy === 'object' ? sec(s).privacy : {});
    const del = (s) => (sec(s).pagineDelicate && typeof sec(s).pagineDelicate === 'object' ? sec(s).pagineDelicate : {});
    if (alza(p(primaSettings), p(dopoSettings))) return true;
    const chiediPrima = pulisciSiti(del(primaSettings).siti);
    const chiediDopo = pulisciSiti(del(dopoSettings).siti);
    if (chiediPrima.some((s) => !chiediDopo.includes(s))) return true;
    const toltiPrima = pulisciSiti(del(primaSettings).nonDelicati);
    return pulisciSiti(del(dopoSettings).nonDelicati).some((s) => !toltiPrima.includes(s));
  }

  // I siti delle pagine delicate dopo un ripristino o un backup: quelli dove Filo chiede sempre restano, e fra i segnati
  // per il campo password restano «non delicati» solo quelli che lo erano già.
  function delicateStrette(attuale, nuova) {
    const a = attuale && typeof attuale === 'object' ? attuale : {};
    const b = nuova && typeof nuova === 'object' && !Array.isArray(nuova) ? nuova : {};
    const giaTolti = pulisciSiti(a.nonDelicati);
    return {
      ...b,
      siti: pulisciSiti([...pulisciSiti(a.siti), ...pulisciSiti(b.siti)]),
      nonDelicati: pulisciSiti(b.nonDelicati).filter((s) => giaTolti.includes(s)),
    };
  }

  // Un ripristino o un backup non alzano quanto esce: livelli e categorie restano i più stretti fra i due, e dei siti in
  // anticipo restano solo quelli che c'erano già. Il resto viene da `nuova`.
  function piuStretta(attuale, nuova) {
    const a = regola({ security: { privacy: attuale } });
    const b = regola({ security: { privacy: nuova } });
    const stretto = (x, y) => (rango(x) >= rango(y) ? x : y);
    return {
      ...(nuova && typeof nuova === 'object' && !Array.isArray(nuova) ? nuova : {}),
      livello: stretto(a.livello, b.livello),
      incognito: stretto(a.incognito, b.incognito),
      chiedi: CATEGORIE.filter((c) => a.chiedi.includes(c) || b.chiedi.includes(c)),
      sitiAnticipo: b.sitiAnticipo.filter((x) => a.sitiAnticipo.includes(x)),
    };
  }

  const nomeLivello = (id) => (LIVELLI.find((l) => l.id === id) || LIVELLI[0]).nome;
  const nomeCategoria = (c) => NOMI_CATEGORIE[c] || String(c || '');
  function elencoParole(voci) {
    if (voci.length < 2) return voci.join('');
    return `${voci.slice(0, -1).join(', ')} e ${voci[voci.length - 1]}`;
  }

  // La riga che dice cosa esce a un livello: nell'intervista e nelle Impostazioni.
  function frase(id, chiedi = PREDEFINITA.chiedi) {
    if (id === 'sempre') return 'Da nessun sito parte niente da solo: spiegazioni, descrizioni delle immagini e controlli del testo li avvii tu con un clic.';
    if (id === 'delicate') return 'Su posta, banca, sanità, enti pubblici e pagine con una password parte solo quello che chiedi tu; sugli altri siti Filo prepara tutto in anticipo.';
    const qui = CATEGORIE.filter((c) => (chiedi || []).includes(c)).map((c) => SU[c]);
    return qui.length
      ? `Filo prepara spiegazioni, descrizioni e controlli in anticipo su ogni sito; ${elencoParole(qui)} chiede prima.`
      : 'Filo prepara spiegazioni, descrizioni e controlli in anticipo su ogni sito, posta, banca e sanità comprese.';
  }

  // Il riquadro che chiede «conferma» quando si alza dalle Impostazioni o dall'intervista (SN_CONFIRM_UI.confirmTyped).
  function confermaAlzata(dopo, prima = null) {
    if (dopo && Array.isArray(dopo.sitiAnticipo) && !dopo.livello && !dopo.incognito && !dopo.chiedi) {
      const gia = pulisciSiti(prima && prima.sitiAnticipo);
      const nuovi = pulisciSiti(dopo.sitiAnticipo).filter((s) => !gia.includes(s));
      return {
        title: 'Privacy: siti in anticipo',
        text: `Filo manderà ai modelli più cose di adesso, senza chiedertelo.\n\nSu ${elencoParole(nuovi)} spiegazioni, descrizioni e `
          + 'controlli del testo partiranno da soli a ogni livello, anche se il sito è delicato. In incognito vale comunque il suo livello.',
        avviso: 'Password, numeri di carta e codici non escono comunque.',
        okLabel: 'Cambia',
      };
    }
    const r = regola({ security: { privacy: dopo } });
    const incognito = dopo && dopo.incognito && !dopo.livello;
    const id = incognito ? r.incognito : r.livello;
    return {
      title: `${incognito ? 'Privacy in incognito' : 'Privacy'}: ${nomeLivello(id)}`,
      text: `Filo manderà ai modelli più cose di adesso, senza chiedertelo.\n\n${frase(id, r.chiedi)}`,
      avviso: 'Password, numeri di carta e codici non escono comunque.',
      okLabel: 'Cambia',
    };
  }

  // Togliere un sito da quelli dove Filo chiede sempre, o dai segnati per un campo password o carta, alza quanto esce
  // come un sito in anticipo in più: lo stesso riquadro.
  function confermaSitiTolti(siti, { campi = false } = {}) {
    const dove = elencoParole((siti || []).map(String));
    return {
      title: campi ? 'Privacy: siti con una password' : 'Privacy: siti dove Filo chiede',
      text: `Filo manderà ai modelli più cose di adesso, senza chiedertelo.\n\n${campi
        ? `Su ${dove} Filo non terrà più conto del campo password o carta che ci ha visto`
        : `Su ${dove} Filo smetterà di chiedere sempre`}: spiegazioni, descrizioni e controlli del testo seguiranno il tuo `
        + 'livello di privacy, e partiranno da soli dove il livello lo lascia fare.',
      avviso: 'Password, numeri di carta e codici non escono comunque.',
      okLabel: 'Cambia',
    };
  }

  // Rimettere com'era un cambio che aveva stretto quanto esce lo riallarga: lo stesso riquadro, col cambio da annullare.
  function confermaAnnullo(fraseCambio) {
    const f = String(fraseCambio || '').trim();
    return {
      title: 'Privacy: rimetti com\'era',
      text: `Filo manderà ai modelli più cose di adesso, senza chiedertelo.\n\n${f ? `Rimetti com'era prima di: ${f}. ` : ''}`
        + 'Spiegazioni, descrizioni e controlli del testo partiranno da soli dove il livello di prima lo lasciava fare.',
      avviso: 'Password, numeri di carta e codici non escono comunque.',
      okLabel: 'Rimetti',
    };
  }

  global.SN_LIVELLI_PRIVACY = {
    LIVELLI, ORDINE, CATEGORIE, PREDEFINITA, regola, chiede, alza, alzaTutto, piuStretta, delicateStrette, frase, confermaAlzata,
    confermaSitiTolti, confermaAnnullo, nomeLivello, nomeCategoria,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_LIVELLI_PRIVACY;
})(typeof globalThis !== 'undefined' ? globalThis : self);
