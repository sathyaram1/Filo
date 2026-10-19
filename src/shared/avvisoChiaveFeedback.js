// L'avviso «manca la chiave dei feedback» delle due pagine che elencano le segnalazioni (Gestione e Feedback), con
// l'azione che la carica, e le chiamate al main per lo stato della chiave. La chiave non passa mai di qui: il file
// lo sceglie e lo legge il main (#1042). Prove: tests/gestione-chiave-feedback.spec.mjs.

(function (global) {
  'use strict';

  const MSG = {
    STATO: 'feedback_chiave_stato',
    CARICA: 'feedback_chiave_carica',
    DIMENTICA: 'feedback_chiave_dimentica',
    CAMBIATA: 'feedback_chiave_cambiata',
  };

  const IN_ELENCO = 'le trovi tutte qui sotto, in un elenco solo.';
  const TESTI = {
    // Chi non gestisce i feedback la chiave non ce l'ha e non la può caricare: gli si dice solo cosa vede.
    generico: 'Questo computer non può leggere lo stato delle segnalazioni. Le trovi tutte qui sotto, in un elenco solo.',
    senzaChiave: `Manca la chiave dei feedback, quindi lo stato delle segnalazioni non si legge: ${IN_ELENCO}`,
    nonApre: `La chiave dei feedback di questo computer non apre lo stato delle segnalazioni: ${IN_ELENCO}`,
    nonApreAmbiente: 'La chiave dei feedback data a Filo all’avvio (FILO_FEEDBACK_PRIVKEY) non apre lo stato delle '
      + `segnalazioni, e vince sulle altre: ${IN_ELENCO}`,
    carica: 'Carica la chiave…',
    caricaAltra: 'Carica un’altra chiave…',
    caricaHover: 'Scegli il file con la chiave privata dei feedback: Filo la custodisce cifrata su questo computer.',
    caricata: 'Chiave caricata: rileggo le segnalazioni…',
    nessunaRisposta: 'Filo non ha risposto: riprova.',
  };

  function chiedi(invia, type) {
    return Promise.resolve()
      .then(() => invia({ type }))
      .catch(() => ({ ok: false, error: TESTI.nessunaRisposta }));
  }

  // Le tre domande al main. Nessuna risposta porta la chiave: solo da dove arriva e se si può custodire.
  const stato = (invia) => chiedi(invia, MSG.STATO);
  const carica = (invia) => chiedi(invia, MSG.CARICA);
  const dimentica = (invia) => chiedi(invia, MSG.DIMENTICA);

  /**
   * Monta l'avviso dentro `el` (l'elemento che la pagina mostra al posto delle sezioni).
   * `admin()`: se chi guarda gestisce i feedback. `onCambiata()`: rilegge le segnalazioni, con la chiave nuova.
   * Torna { aggiorna } da chiamare ogni volta che l'avviso si mostra.
   */
  function monta(el, { invia, admin, onCambiata }) {
    if (!el) return { aggiorna() {} };
    el.classList.add('sn-chiave-avviso');
    const testo = document.createElement('span');
    testo.className = 'sn-chiave-testo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary sn-chiave-carica';
    btn.title = TESTI.caricaHover;
    btn.hidden = true;
    const esito = document.createElement('span');
    esito.className = 'sn-chiave-esito';
    esito.setAttribute('role', 'status');
    el.replaceChildren(testo, btn, esito);

    let noto = null;      // l'ultimo stato letto dal main
    let chiesto = false;  // la lettura dello stato è partita
    let ricarica = null;

    function scriviEsito(t, kind) {
      esito.textContent = t || '';
      if (kind) esito.dataset.kind = kind; else delete esito.dataset.kind;
    }

    function disegna() {
      if (!admin()) {
        testo.textContent = TESTI.generico;
        btn.hidden = true;
        return;
      }
      const s = noto || {};
      const configurata = !!s.configurata;
      if (s.fonte === 'ambiente') {
        testo.textContent = TESTI.nonApreAmbiente;
        btn.hidden = true;
        return;
      }
      if (noto && !s.custodibile) {
        // Senza portachiavi niente tasto che fallirebbe sempre: si dice perché e cosa serve.
        testo.textContent = `${configurata ? TESTI.nonApre : TESTI.senzaChiave} ${s.motivo || ''}`.trim();
        btn.hidden = true;
        return;
      }
      testo.textContent = configurata ? TESTI.nonApre : TESTI.senzaChiave;
      btn.textContent = configurata ? TESTI.caricaAltra : TESTI.carica;
      btn.hidden = false;
    }

    async function rileggi() {
      const r = await stato(invia);
      noto = r && r.ok ? r : null;
      disegna();
    }

    function aggiorna() {
      disegna();
      if (admin() && !chiesto) { chiesto = true; rileggi(); }
    }

    // Risposta e avviso del main arrivano insieme: una rilettura sola.
    function cambiata() {
      noto = null;
      chiesto = false;
      if (ricarica) return ricarica;
      // Mentre si rilegge il tasto è spento: un secondo clic riaprirebbe la finestra di scelta per niente.
      btn.disabled = true;
      ricarica = Promise.resolve()
        .then(() => (typeof onCambiata === 'function' ? onCambiata() : null))
        .catch(() => {})
        .finally(() => {
          ricarica = null;
          btn.disabled = false;
          if (esito.dataset.kind === 'ok') scriviEsito('');
          if (!el.hidden) aggiorna();
        });
      return ricarica;
    }

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      scriviEsito('');
      const r = await carica(invia);
      btn.disabled = false;
      if (r && r.ok) {
        noto = r;
        scriviEsito(TESTI.caricata, 'ok');
        cambiata();
        return;
      }
      if (r && r.canceled) return;
      scriviEsito((r && r.error) || 'Non riuscito.', 'err');
      if (r && r.custodibile === false) { noto = r; disegna(); }
    });

    if (global.filo && typeof global.filo.onBroadcast === 'function') {
      global.filo.onBroadcast((m) => {
        if (m && m.type === MSG.CAMBIATA) cambiata();
      });
    }

    return { aggiorna };
  }

  global.SN_AVVISO_CHIAVE = { MSG, TESTI, stato, carica, dimentica, monta };
})(typeof globalThis !== 'undefined' ? globalThis : this);
