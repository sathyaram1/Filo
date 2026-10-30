// Mittenti (SPEC-DOMANDE.md §10): dal clientId a una classe normalizzata, per statistica e lettura. Nessun permesso
// nasce da qui (li decide `fiducia`); è l'unico posto, app e server (bake-shared → functions/src/mittente.js), che
// legge il prefisso del mittente. Prove: tests/unit/mittenti.test.mjs e functions/test/mittenti-solo-statistica.test.js.

(function (global) {
  'use strict';

  const CLASSI = Object.freeze(['owner', 'utente', 'filo_per_utente', 'sessione_locale', 'routine', 'server', 'test']);
  // I ruoli che il server scrive dopo `routine:` (quelli dei biglietti più i rilievi residui). Fuori elenco (etichette
  // storiche, nomi di sessione della vecchia coda) vale `ignoto`: la statistica non inventa ruoli.
  const RUOLI = Object.freeze(['new-work', 'fixer', 'verifier', 'secaudit', 'risposta', 'smistamento', 'compito', 'prober', 'residuo']);
  const RUOLO_IGNOTO = 'ignoto';
  // Le classi dell'owner e dei suoi processi: valgono solo con la prova del mittente, che un client anonimo non scrive.
  const PROCESSI = Object.freeze(['owner', 'sessione_locale', 'routine', 'server']);
  const PROVE = Object.freeze(['admin', 'server']);
  // #912: il server riscrive così un nome riservato arrivato senza prova.
  const NON_PROVATO = 'non-provato:';
  const RISERVATO_RE = /^(owner|routine|agent|local):/i;
  const CIFRATO_RE = /^FENC1:/;
  const TEST_RE = /^(test|verifica)([:_-]|$)/i;
  // L'allarme della costruzione, l'unico mittente che il server scrive a nome suo.
  const SERVER_AGENTE = 'costruzione';

  function nomeRiservato(clientId) {
    return RISERVATO_RE.test(String(clientId || ''));
  }

  function ruoloDi(resto) {
    const r = String(resto || '').split(':')[0].trim().toLowerCase();
    return RUOLI.indexOf(r) >= 0 ? r : RUOLO_IGNOTO;
  }

  function voce(classe, ruolo) {
    return { classe, ruolo: classe === 'routine' ? (ruolo || RUOLO_IGNOTO) : '' };
  }

  /**
   * `fb` = { clientId (in chiaro), senderProof }. → { classe, ruolo } (ruolo solo per `routine`, altrimenti ''), o null
   * se il clientId è ancora cifrato: senza chiave non si indovina. PURA.
   */
  function classifica(fb) {
    const grezzo = String((fb && fb.clientId) || '').trim();
    if (CIFRATO_RE.test(grezzo)) return null;
    const rinunciato = grezzo.toLowerCase().indexOf(NON_PROVATO) === 0;
    const c = rinunciato ? grezzo.slice(NON_PROVATO.length) : grezzo;
    const prova = fb && fb.senderProof;
    const provato = !rinunciato && PROVE.indexOf(prova) >= 0;
    const i = c.indexOf(':');
    const famiglia = (i >= 0 ? c.slice(0, i) : c).toLowerCase();
    const resto = i >= 0 ? c.slice(i + 1) : '';
    // `routine` senza due punti è il ripiego del server quando una consegna non dà il ruolo.
    if (famiglia === 'routine') return provato ? voce('routine', ruoloDi(resto)) : voce('utente');
    if (i >= 0) {
      if (famiglia === 'owner') return voce(provato ? 'owner' : 'utente');
      if (famiglia === 'local') return voce(provato ? 'sessione_locale' : 'utente');
      // Ogni altro `agent:` è l'esploratore di test:explore, che crea senza prova: classe di prova anche così.
      if (famiglia === 'agent') {
        const allarme = provato && prova === 'server' && resto.trim().toLowerCase() === SERVER_AGENTE;
        return voce(allarme ? 'server' : 'test');
      }
      if (famiglia === 'auto' || famiglia === 'filo') return voce('filo_per_utente');
    }
    if (TEST_RE.test(c)) return voce('test');
    return voce('utente');
  }

  /**
   * La classe di un documento: quella scritta dal server se valida, altrimenti calcolata dal clientId in chiaro.
   * → { classe, ruolo } o null (né scritta né leggibile). PURA.
   */
  function mittenteDi(doc) {
    const scritta = doc && doc.mittenteClasse;
    if (typeof scritta === 'string' && CLASSI.indexOf(scritta) >= 0) {
      const r = doc.mittenteRuolo;
      return voce(scritta, typeof r === 'string' && RUOLI.indexOf(r) >= 0 ? r : RUOLO_IGNOTO);
    }
    return classifica(doc);
  }

  /** I campi da scrivere sul documento: `mittenteRuolo` solo per una routine. PURA. */
  function campiDi(m) {
    if (!m || CLASSI.indexOf(m.classe) < 0) return null;
    return m.classe === 'routine' ? { mittenteClasse: 'routine', mittenteRuolo: m.ruolo || RUOLO_IGNOTO } : { mittenteClasse: m.classe };
  }

  /** Un processo dell'owner con la prova (owner, sessione, routine, allarme): per chi legge, non per i permessi. */
  function diProcesso(doc) {
    const m = mittenteDi(doc);
    return !!m && PROCESSI.indexOf(m.classe) >= 0;
  }

  const DA_RUOLO = Object.freeze({
    verifier: 'un verificatore automatico (rilievo emerso verificando un altro lavoro)',
    residuo: 'rilievi residui di una verifica automatica',
    prober: 'l\'agente esploratore automatico',
  });

  /**
   * Chi l'ha scritto, in parole, per il giudice di priorità; `automatico` mette il tetto alla priorità (routine e
   * rilievi automatici dell'app; non la sessione locale, che vale come l'owner). PURA.
   */
  function provenienza(doc) {
    const m = mittenteDi(doc) || voce('utente');
    switch (m.classe) {
      case 'owner': return { testo: 'l\'owner', automatico: false };
      case 'sessione_locale': return { testo: 'Claude in una sessione locale con l\'owner (vale come l\'owner)', automatico: false };
      case 'routine': return { testo: DA_RUOLO[m.ruolo] || 'un\'automazione', automatico: true };
      case 'server': return { testo: 'un allarme del server di Filo', automatico: false };
      case 'test': return { testo: 'un agente che collauda l\'app', automatico: false };
      case 'filo_per_utente': {
        const auto = /^auto:/i.test(String((doc && doc.clientId) || ''));
        return auto
          ? { testo: 'un rilievo automatico dell\'app', automatico: true }
          : { testo: 'Filo stesso, durante una chat con un utente', automatico: false };
      }
      default: return { testo: 'un utente', automatico: false };
    }
  }

  global.SN_MITTENTI = {
    CLASSI, RUOLI, RUOLO_IGNOTO, PROCESSI, PROVE, NON_PROVATO,
    classifica, mittenteDi, campiDi, diProcesso, nomeRiservato, provenienza,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
