// I pulsanti della pagina Preferenze che fanno un'azione, chiesti in chat (#1619): logica pura, dice cosa fare.
// Non scrive, non suona e non apre niente: esegue il main (PULSANTE_PREFERENZE), e il ripristino lo usa anche la pagina.
// Regole: tests/unit/pulsantiPreferenze.test.mjs.

(function (global) {
  'use strict';

  const PULSANTI = Object.freeze(['prova_suono', 'prova_suoneria', 'prova_voce', 'rifai_intervista', 'ripristina_tutto']);

  function pulsanteDi(action) {
    const a = action || {};
    const s = String(a.pulsante ?? a.azione ?? a.button ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return PULSANTI.includes(s) ? s : '';
  }

  const detto = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // Quello che il modello ha scritto torna all'utente nel diario: si controlla intero, si ripete corto.
  const eco = (t) => (t.length > 40 ? `${t.slice(0, 39)}…` : t);

  function volumeDa(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 100;
  }

  // Il tono detto, o quello salvato; il volume è quello salvato, cioè come suonerà davvero.
  function provaTono(action, settings) {
    const P = global.SN_PREF;
    const s = settings || {};
    const suoneria = pulsanteDi(action) === 'prova_suoneria';
    const n = s.notifications || {};
    const chiesto = detto(action && action.tono);
    const salvato = suoneria ? s.timerRingtone : n.sound;
    const tono = chiesto ? P.tonoDa(chiesto) : (P.TONI_ETICHETTE[salvato] ? salvato : 'default');
    if (!tono) return { rifiuto: `il tono «${eco(chiesto)}» non c'è: si sceglie fra standard, delicata, urgente e carillon` };
    const volume = volumeDa(suoneria ? s.timerRingtoneVolume : n.soundVolume);
    return { tono, volume, etichetta: P.TONI_ETICHETTE[tono], suoneria, acceso: suoneria || n.soundEnabled === true };
  }

  // La voce detta passa dallo stesso controllo di «voce_modello»: un nome che lì non si salva qui non si prova.
  function provaVoce(action, settings) {
    const P = global.SN_PREF;
    const V = global.SN_TTS_VOICES;
    const chiesta = detto(action && action.voce);
    let voce = String((settings && settings.tts && settings.tts.modelVoice) || '').trim();
    if (chiesta) {
      const b = P.buildPreferencePartial('voce_modello', chiesta);
      if (!b || b.rifiuto || !b.partial || !b.partial.tts) {
        return { rifiuto: (b && b.rifiuto) || `«${eco(chiesta)}» non è il nome di una voce` };
      }
      voce = String(b.partial.tts.modelVoice || '');
    }
    const lang = (voce && V && V.langOfVoice(voce)) || 'it';
    const frasi = (V && V.FRASI_DI_PROVA) || {};
    const testo = frasi[lang] || frasi.it || 'Ciao, sono Filo.';
    const etichetta = voce ? eco((V && V.labelOfVoice(voce)) || voce) : 'automatica';
    return { voce, lang, testo, etichetta };
  }

  // Le impostazioni che il ripristino scrive, intere, così spariscono anche le chiavi residue. Restano le chiavi
  // dei fornitori e il registro dei modelli; l'autonomia non sale, perché alzarla vuole «conferma» (#530).
  function impostazioniDiSerie(correnti) {
    const C = global.SN_CONST;
    const A = global.SN_AUTONOMIA;
    const out = JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
    if (correnti && correnti.apiKeys) out.apiKeys = correnti.apiKeys;
    if (correnti && correnti.modelRegistry) out.modelRegistry = correnti.modelRegistry;
    if (A && correnti) out.autonomia = A.unisciPiuStretta(correnti.autonomia, out.autonomia);
    return out;
  }

  global.SN_PULSANTI_PREFERENZE = { PULSANTI, pulsanteDi, provaTono, provaVoce, impostazioniDiSerie };
})(typeof globalThis !== 'undefined' ? globalThis : self);
