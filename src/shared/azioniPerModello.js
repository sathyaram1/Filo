// Come un'azione di Filo torna al modello: la frase coi testi salvati al posto di «voce N», e i riepiloghi del turno dopo.
// Logica pura: niente I/O, niente decisioni su cosa parte (quelle stanno in actionLevels.js e autonomia.js).
// Prove: tests/unit/azioniPerModello.test.mjs, tests/chat-testi-salvati-recintati.spec.mjs.

(function (global) {
  'use strict';

  // I campi che portano un testo salvato da Filo, oltre alle voci colpite
  // (`_targets`, per ogni azione): un'azione nuova che ripete un nome salvato va qui.
  const CAMPI_SALVATI = {
    TIMER: ['label', 'etichetta'],
    SVEGLIA: ['label', 'etichetta'],
    SALVA_LEZIONE: ['testo', 'text', 'lezione'],
    DIMENTICA: ['_righe'],
    CORREGGI_MEMORIA: ['_righe', 'nuovo'],
    ANNULLA_CAMBIO: ['_fraseCambio'],
    BLUETOOTH: ['_nomeSistema'],
    WIFI: ['_nomeSistema'],
    APRI_SALVATA: ['_titolo'],
    TOGLI_CHAT: ['_titolo'],
    RIMETTI_CHAT: ['_titolo'],
  };

  // L'utente vede sempre il testo vero, nel popup come nel diario: un «voce 1» in una risposta gli nomina una cosa
  // che non ha mai visto (#1396).
  function notaSegnaposti(numeri) {
    const nomi = numeri.map((n) => `«voce ${n}»`);
    const elenco = nomi.length > 3 ? `Le etichette da ${nomi[0]} a ${nomi[nomi.length - 1]}`
      : nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : nomi[0];
    return nomi.length > 1
      ? `(${elenco} sono segnaposti tuoi per i testi qui sotto: l'utente non li vede da nessuna parte, dove gli si mostra la cosa compare il testo vero. Con lui non scriverli mai: nomina le cose col loro contenuto o con parole tue.)`
      : `(${elenco} è un segnaposto tuo per il testo qui sotto: l'utente non lo vede da nessuna parte, dove gli si mostra la cosa compare il testo vero. Con lui non scriverlo mai: nomina la cosa col suo contenuto o con parole tue.)`;
  }

  // I testi salvati che una descrizione ripete (#592.4): nella frase di Filo
  // diventano «voce N», e i testi veri stanno nel recinto sotto, ripuliti.
  function descrivi(action, { fatto = false } = {}) {
    const Levels = global.SN_ACTION_LEVELS;
    if (!Levels) return '';
    const descriviCon = fatto && Levels.describeDone ? Levels.describeDone : Levels.describe;
    const tipo = String((action && action.type) || '').toUpperCase();
    const voci = [];
    const voce = (v) => {
      const s = String(v);
      if (!voci.includes(s)) voci.push(s);
      return `voce ${voci.indexOf(s) + 1}`;
    };
    const copia = { ...action };
    for (const campo of ['_targets', ...(CAMPI_SALVATI[tipo] || [])]) {
      const v = action && action[campo];
      if (Array.isArray(v)) copia[campo] = v.map(voce);
      else if (typeof v === 'string' && v.trim()) copia[campo] = voce(v);
    }
    const frase = descriviCon(copia) || '';
    const usate = voci.map((v, i) => ({ v, n: i + 1 })).filter(({ n }) => new RegExp(`\\bvoce ${n}\\b`).test(frase));
    if (!usate.length) return frase;
    const E = global.SN_ESTERNO;
    return `${frase}\n${notaSegnaposti(usate.map(({ n }) => n))}\n${E.imbusta({
      tipo: 'TESTO_SALVATO',
      testo: usate.map(({ v, n }) => `voce ${n}: ${E.neutralizza(v, { unaRiga: true })}`).join('\n'),
    })}`;
  }

  function righeFatte(actions, salta) {
    const righe = [];
    for (const a of actions) {
      if (!a || salta(a)) continue;
      let cosa = String(a.type || '').toUpperCase();
      try {
        const d = descrivi(a, { fatto: true });
        if (d) cosa = d.replace(/\.+\s*$/, '');
      } catch (_) {}
      righe.push(`- ${cosa}`);
    }
    return righe;
  }

  // Un tentativo interrotto a metà da un guasto (rete, fornitore): queste azioni
  // sono state eseguite PRIMA che tutto si fermasse, e ripeterle vuol dire un
  // secondo timer, un secondo appunto. Dato di sistema, non istruzione.
  // `fermato`: l'ha fermato l'utente col quadrato (#578), non un guasto. Lo si dice anche senza azioni fatte: al turno
  // dopo il modello deve sapere che la risposta di prima non c'è.
  function interrotte(actions, { fermato = false } = {}) {
    const righe = righeFatte(Array.isArray(actions) ? actions : [], (a) => a._executed === false || a._confirm);
    if (fermato) {
      return righe.length
        ? `[L'utente ti ha fermato a metà lavoro, prima che rispondessi. Queste cose ERANO GIÀ STATE FATTE:\n${righe.join('\n')}\nNon rifarle.]`
        : '[L\'utente ti ha fermato a metà lavoro, prima che rispondessi.]';
    }
    return righe.length
      ? `[Il tentativo si è interrotto per un guasto, ma queste cose ERANO GIÀ STATE FATTE:\n${righe.join('\n')}\nNon rifarle: riprendi da qui.]`
      : '';
  }

  // Le azioni che l'utente ha CONFERMATO nel popup dopo che il turno era già
  // finito (livello 2 e 3). Il modello non le vede in nessun altro modo: quando
  // ha emesso l'azione era «in attesa di conferma», e il sì è arrivato dopo. Se
  // al turno dopo l'utente chiede «l'hai attivato?», senza questa riga può solo
  // tirare a indovinare. Il popup chiuso col sì è detto perché il modello non ne inventi uno doppio (#1396).
  function confermate(actions) {
    if (!Array.isArray(actions)) return '';
    const righe = righeFatte(actions, (a) => !a._confirmed);
    return righe.length
      ? `[L'utente ha CONFERMATO e il sistema ha eseguito, dopo la tua risposta:\n${righe.join('\n')}\n`
        + 'È già fatto e il popup di conferma si è chiuso con quel sì: non riproporlo, non dire che è ancora da fare '
        + 'e non parlare di altri popup per queste cose.]'
      : '';
  }

  global.SN_AZIONI_PER_MODELLO = { CAMPI_SALVATI, descrivi, interrotte, confermate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
