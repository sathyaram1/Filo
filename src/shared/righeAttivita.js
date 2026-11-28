// Le parole del diario del lavoro per ogni azione di Filo: la riga in diretta della home e quella della chat riaperta
// (#1294) leggono da qui, nel main e nella pagina. Niente DOM. Sentinella: tests/unit/diarioAzioniCoperte.test.mjs.
(function (global) {
  'use strict';

  function isType(a, t) {
    return String((a && a.type) || '').toUpperCase() === t;
  }
  // Le azioni che si raccontano con una riga (icona + due parole) invece che
  // con un bottone: sono già eseguite dal main o sono passi intermedi, e
  // cliccarle non farebbe niente (#376). Una sola tabella, così l'icona di
  // un'azione sta in un posto solo. Ciò che è cliccabile — un link da aprire,
  // una conferma da dare, l'esito di un comando — resta un bottone sotto la
  // risposta e NON passa di qui.
  // Il testo scritto dal modello prima di finire in una riga: senza caratteri
  // di controllo (un byte nullo nell'etichetta finiva tale e quale nel diario).
  function pulito(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }
  // Un valore che non è parola di Filo (scelto dal modello, scritto da un sito, letto dal disco) entra nella riga come
  // pezzo suo, che la home e la chat riaperta chiudono nel riquadro (#2648). Il testo piatto resta quello di sempre:
  // `fra` è un valore che la riga dice fra «», `suo` uno che dice nudo. Sentinella: tests/unit/righeEsitoAPezzi.test.mjs.
  const suo = (v) => esito().suo(pulito(v));
  const fra = (v) => esito().fra(pulito(v));
  const corto = (v, max) => { const t = pulito(v); return t.length > max ? `${t.slice(0, max - 3)}…` : t; };
  const unisci = (pezzi, sep) => esito().unisci(pezzi, sep);
  function aPezzi(icon, pezzi, resto) {
    const parti = [];
    for (const p of pezzi) {
      if (p === '' || p == null) continue;
      if (typeof p === 'string' && typeof parti[parti.length - 1] === 'string') parti[parti.length - 1] += p;
      else parti.push(p);
    }
    const r = { icon, text: piatto(parti), ...resto };
    return parti.some((p) => typeof p !== 'string') ? { ...r, parti } : r;
  }
  // Le regole dei pezzi stanno in SN_ESITO; chi carica solo questo modulo (il main, una prova) lo trova lo stesso.
  function esito() {
    if (!global.SN_ESITO && typeof require === 'function') { try { require('./esitoAzione.js'); } catch (_) {} }
    return global.SN_ESITO;
  }
  const piatto = (parti) => esito().piatto(parti);
  const restanoAperte = (o) => global.SN_ESITO.restanoAperte(o);
  // Titolo e testo di una segnalazione li sceglie src/shared/allegatiSegnalazione.js, come l'invio e il riquadro.
  function segnalazione() {
    if (!global.SN_ALLEGATI_SEGNALAZIONE && typeof require === 'function') { try { require('./allegatiSegnalazione.js'); } catch (_) {} }
    return global.SN_ALLEGATI_SEGNALAZIONE || null;
  }
  // «lunedì 28 set»: il giorno di una conversazione senza titolo.
  function quandoBreve(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  // Le frasi dei cambi coi valori non di Filo nel riquadro (`parti`, del registro dei cambi); pezzi che non dicono la
  // loro frase non valgono, e resta la frase (#2648.1).
  function pezziCambi(a) {
    const l = Array.isArray(a && a._cambi) ? a._cambi : [];
    const una = (c) => {
      const f = pulito(c && c.frase);
      const p = f && esito().partiDellaRiga(c.parti, f);
      return p ? p.filter((x) => x !== '') : [f];
    };
    return unisci(l.map(una).filter((p) => p[0] !== ''), '; ').flat();
  }
  const ACTIVITY_ROWS = {
    TIMER: (a) => {
      const sec = Number(a.seconds || a.secondi || 0);
      // #323 — durata umana fedele all'intento: "30 sec", "2 h", "1 h 30 min".
      const dur = (global.SN_TIME ? global.SN_TIME.fmtDurationLabel(sec) : `${Math.round(sec / 60)} min`);
      const name = pulito(a.label || a.etichetta);
      return aPezzi('⏱', ['Timer avviato · ', ...(name ? [suo(name), ' · '] : []), dur]);
    },
    SVEGLIA: (a) => {
      const when = pulito(a.time || a.orario);
      const name = pulito(a.label || a.etichetta);
      return aPezzi('⏰', ['Sveglia impostata', ...(when ? [' · ', suo(when)] : []), ...(name ? [' · ', suo(name)] : [])]);
    },
    // Il main descrive cosa ha tolto o spostato («Sveglia “lezione” 07:55»):
    // se si può aggiungere una sveglia dalla chat, si deve vedere anche
    // quando la si toglie.
    CANCELLA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.removed)) ? a._output.removed : [];
      return aPezzi('⏰', ['Cancellata · ', ...nomiSveglie(list, a)]);
    },
    MODIFICA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.updated)) ? a._output.updated : [];
      return aPezzi('⏰', ['Spostata · ', ...nomiSveglie(list, a)]);
    },
    // Nel calendario l'evento ci entra col bottone: qui si racconta la
    // proposta, e chiamarla «creata» era una promessa che nessuno manteneva.
    EVENTO_CALENDARIO: (a) => {
      const ev = (a._output && a._output.evento) || null;
      const quando = ev && ev.quando ? ` · ${ev.quando}` : '';
      const nome = [suo((ev && ev.titolo) || a.titolo || a.title), quando];
      const fatto = a._output && a._output.fatto;
      // Nessun programma ha aperto il file: l'evento c'è, ma nel calendario non ancora.
      if (fatto && a._output.nonAperto) return aPezzi('📅', ['Evento salvato in un file, il calendario non si è aperto · ', ...nome]);
      return aPezzi('📅', [`${fatto ? 'Evento aggiunto al calendario' : 'Evento proposto'} · `, ...nome]);
    },
    // Impostazione applicata subito (livello 1, es. il tema): prima non
    // lasciava traccia in chat, come se non fosse successo niente.
    // La frase è quella dell'evento del filo, col nome della pagina Preferenze (#557, #867); senza
    // evento il valore era già quello.
    IMPOSTA_PREFERENZA: (a) => {
      const o = a._output || {};
      const f = pezziCambi(a);
      // Il costo del modello scelto per una funzione resta scritto anche se il modello non lo ripete (#819).
      const costo = pulito(o.costoModello);
      const coda = costo ? ` · ${costo}` : '';
      if (f.length) return aPezzi('⚙', ['Impostato · ', ...f, coda]);
      const valore = suo(o.valore);
      if (valore && pulito(o.campo)) return aPezzi('⚙', [`Già così · ${pulito(o.campo)} → `, valore, coda]);
      const etichetta = pulito(o.etichetta);
      return { icon: '⚙', text: `${etichetta ? `Già così · ${etichetta}` : 'Impostazione già così'}${coda}` };
    },
    ANNULLA_CAMBIO: (a) => {
      const o = a._output || {};
      const f = pezziCambi({ _cambi: [{ frase: o.frase, parti: o.fraseParti }] });
      return aPezzi('↩', ['Rimesso com’era', ...(f.length ? [' · prima di: ', ...f] : [])]);
    },
    // Passi intermedi (#368/#376): la ricerca è già partita nel main e i
    // risultati rientrano nel turno successivo, dove compare la risposta.
    CERCA_WEB: (a) => aPezzi('🔎', ['Cerco sul web: ', suo(a.query)]),
    IMMAGINI_WEB: (a) => aPezzi('🖼', ['Cerco immagini: ', suo(a.query)]),
    GENERA_IMMAGINE: () => ({ icon: '🖌', text: 'Disegno un’immagine' }),
    ESPANDI_FILO: (a) => {
      const o = a._output || {};
      return { icon: '💬', text: o.righe ? `Rileggo il filo di quelle ore · ${o.righe} cose` : 'Rileggo il filo di quelle ore' };
    },
    CERCA_CHAT: (a) => {
      // Ripescati da Filo senza che il modello li chiedesse (#868): si dice da quali conversazioni, ognuna una volta
      // anche quando ne arrivano più pezzi (#868.2).
      if (a._auto) {
        const r = (a._output && Array.isArray(a._output.results)) ? a._output.results : [];
        const viste = new Set();
        const una = r.filter((x) => {
          const k = (x && x.id) || '';
          if (!k) return true;
          if (viste.has(k)) return false;
          viste.add(k);
          return true;
        });
        // Il titolo l'ha scritto qualcun altro, il giorno lo dice Filo.
        const dette = new Set();
        const quali = [];
        for (const x of una) {
          const t = pulito(x.title);
          const q = t || quandoBreve(x.date);
          if (!q || dette.has(q)) continue;
          dette.add(q);
          quali.push(t ? suo(t) : q);
        }
        return aPezzi('💬', ['Ricordato dal filo', ...(quali.length ? [' · ', ...unisci(quali, '; ')] : [])], { tipo: 'RICORDO_FILO' });
      }
      const q = String(a.query || a.testo || '').trim();
      if (a.id && !q) return { icon: '💬', text: 'Rileggo una conversazione di prima' };
      return aPezzi('💬', ['Cerco nel filo: ', suo(q)]);
    },
    CAPACITA_DETTAGLIO: () => ({ icon: '📖', text: 'Verifico cosa so fare' }),
    LEGGI_MEMORIA: () => ({ icon: '🧠', text: 'Rileggo la memoria' }),
    LEGGI_IMPOSTAZIONI: (a) => {
      const c = String(a.cerca || '').trim();
      return c ? aPezzi('⚙', ['Leggo come è impostato: ', suo(c)]) : { icon: '⚙', text: 'Leggo le impostazioni' };
    },
    TOGLI_PERMESSO_SITO: (a) => {
      const tolte = (a._output && Array.isArray(a._output.tolte)) ? a._output.tolte.map(pulito).filter(Boolean) : [];
      return aPezzi('⚙', ['Permesso tolto · ', tolte.length ? tolte.join('; ') : suo(a.sito)]);
    },
    LEGGI_FILE: (a) => {
      const title = (a._output && a._output.title) || '';
      return title ? aPezzi('📄', ['Leggo: ', suo(title)]) : { icon: '📄', text: 'Leggo un file' };
    },
    LEGGI_DOCUMENTO: (a) => {
      const nome = (a._output && a._output.name) || '';
      return nome ? aPezzi('📄', ['Leggo il documento: ', suo(nome)]) : { icon: '📄', text: 'Leggo il documento' };
    },
    // #778 — quale finestra ha guardato; quello che c'era sta nella risposta, non nel diario.
    VEDI_SCHERMO: (a) => {
      const o = a._output || {};
      if (Array.isArray(o.ambigue)) return aPezzi('🖥', ['Più finestre per ', fra(o.richiesta)]);
      if (Array.isArray(o.elenco) && !o.testo) return { icon: '🖥', text: 'Guardato quali finestre sono aperte' };
      const nome = pulito(o.finestra);
      return nome ? aPezzi('🖥', ['Ho guardato ', fra(nome)]) : { icon: '🖥', text: 'Ho guardato lo schermo' };
    },
    CERCA_DOCUMENTI: (a) => aPezzi('🔎', pezziRicercaDocumenti(a)),
    CERCA_SALVATE: (a) => aPezzi('🔖', pezziRicercaSalvate(a)),
    APRI_SALVATA: (a) => {
      const o = a._output || {};
      return aPezzi('↗', ['Aperta ', fra(o.titolo) || '«una pagina salvata»', o.tolta ? ' · tolta da «Aperti per dopo»' : ' · resta in «Aperti per dopo»']);
    },
    SCHEDE_CHIUSE: (a) => {
      const o = a._output || {};
      const n = Array.isArray(o.schede) ? o.schede.length : 0;
      const q = fra(a.cerca);
      const cosa = q ? [' · ', q] : [];
      return aPezzi('🗂', [n ? (n === 1 ? 'Trovata una scheda chiusa' : `Trovate ${n} schede chiuse`) : 'Nessuna scheda chiusa trovata', ...cosa]);
    },
    RIAPRI_SCHEDA: (a) => {
      const o = a._output || {};
      const t = fra(o.titolo || a._titolo) || '«la scheda»';
      return aPezzi('↺', o.nonRaggiungibile ? [t, ' non risponde più · sotto c\'è il riassunto'] : ['Riaperta ', t]);
    },
    RIPRENDI_AUDIO: (a) => {
      const o = a._output || {};
      const t = fra(o.titolo) || '«la musica»';
      if (o.nonPartita) return aPezzi('🎵', [`${o.riaperta ? 'Riaperta' : 'Trovata'} `, t, ' · non è ripartita da sola']);
      return aPezzi('🎵', [`${o.riaperta ? 'Riaperta e ripartita' : 'Ripartita'} `, t]);
    },
    PAUSA_AUDIO: (a) => {
      const o = a._output || {};
      const t = fra(o.titolo || a._titolo);
      return t ? aPezzi('⏸', ['In pausa ', t]) : { icon: '⏸', text: 'Musica in pausa' };
    },
    MOSTRA_SCHEDA: (a) => {
      const o = a._output || {};
      return aPezzi('↗', ['Ti ho portato su ', fra(o.titolo || a._titolo) || '«la scheda»']);
    },
    BLOCCA_SCHEDA: (a) => {
      const o = a._output || {};
      return aPezzi('🔒', [o.gia ? 'Era già bloccata ' : 'Bloccata ', fra(o.titolo || a._titolo) || '«la scheda»']);
    },
    SBLOCCA_SCHEDA: (a) => {
      const o = a._output || {};
      return aPezzi('🔓', [o.gia ? 'Non era bloccata ' : 'Sbloccata ', fra(o.titolo || a._titolo) || '«la scheda»']);
    },
    SALVA_PER_DOPO: (a) => {
      const o = a._output || {};
      return aPezzi('🔖', ['Salvata per dopo ', fra(o.titolo || a._titolo) || '«la pagina»']);
    },
    CERCA_IMMAGINE: (a) => {
      const o = a._output || {};
      return { icon: '🔎', text: o.numero ? `Cercata con Google Lens l'immagine ${o.numero}` : 'Cercata con Google Lens l\'immagine della pagina' };
    },
    LEGGI_TRASPARENZA: () => ({ icon: '📄', text: 'Rileggo la pagina di trasparenza' }),
    LEGGI_PAGINA: (a) => aPezzi('🌐', pezziLetturaPagina(a), { title: indirizzoLetto(a) }),
    RINOMINA_FILE: (a) => ({ icon: '✎', text: testoRinominati(a._output) }),
    ELIMINA_FILE: (a) => aPezzi('🗑', pezziEliminati(a._output)),
    // Le azioni che non lasciano niente da cliccare in chat: prima sparivano
    // del tutto, e l'utente non sapeva dove fosse finito il suo appunto.
    SALVA_APPUNTO: (a) => {
      const dove = suo(a.contesto || a.context || a.argomento);
      return aPezzi('📝', ['Appunto salvato', ...(dove ? [' · ', dove] : [])]);
    },
    SALVA_LEZIONE: (a) => aPezzi('🧠', ['Memorizzato · ', suo(corto(a.testo || a.text || a.lezione, 60))]),
    DIMENTICA: (a) => {
      const tolte = (a._output && Array.isArray(a._output.dimenticate)) ? a._output.dimenticate : [];
      return aPezzi('🧠', ['Dimenticato · ', suo(corto(tolte.join(', ') || a.testo, 80))]);
    },
    // #1295 — una conversazione nascosta o cancellata a parole: la riga dice quale, e se si rimette.
    TOGLI_CHAT: (a) => aPezzi('💬', [`${a.per_sempre === true ? 'Cancellata per sempre' : 'Nascosta'} · `, suo(corto(a._titolo, 80)) || 'una conversazione']),
    RIMETTI_CHAT: (a) => aPezzi('💬', ['Rimessa nel filo · ', suo(corto(a._titolo, 80)) || 'una conversazione']),
    CORREGGI_MEMORIA: (a) => aPezzi('🧠', ['Corretto · ', suo(corto((a._output && a._output.corretta) || a.nuovo, 80))]),
    // Le due azioni che l'utente conferma nel popup e poi non ritrova da
    // nessuna parte: proprio quelle che non si disfano più.
    CANCELLA_MEMORIA: () => ({ icon: '🧠', text: 'Memoria cancellata' }),
    INVIA_FEEDBACK: (a) => {
      const S = segnalazione();
      const t = suo(S ? S.campi(a).titolo : '');
      return aPezzi('📨', ['Segnalazione inviata', ...(t ? [' · ', t] : [])]);
    },
    ONBOARDING: (a) => {
      if (sceltaAutonomia(a)) {
        const o = a._output;
        const cosa = [o.sceltaAutonomia ? 'dell’autonomia' : '', o.sceltaPrivacy ? 'della privacy' : ''].filter(Boolean).join(' e ');
        return { icon: '👋', text: `Accoglienza · scelta ${cosa}` };
      }
      if (sceltaContatori(a)) return { icon: '👋', text: 'Accoglienza · scelta dei contatori' };
      if (a && (a.fine ?? a.chiudi ?? a.done)) return { icon: '👋', text: 'Accoglienza conclusa' };
      const ids = Array.isArray(a && a.spunta) ? a.spunta : [];
      return aPezzi('👋', ['Accoglienza · ', suo(ids.join(', ')) || 'passo fatto']);
    },
    IMPOSTA_ESTETICA: (a) => {
      const tok = a.token || a.nome || a.name || a.chiave || a.elemento || '';
      // Il nome leggibile sta nel registro dei token: `button.bg` non dice
      // niente a chi ha chiesto di cambiare l'aspetto (#726).
      const T = global.SN_THEME_TOKENS;
      const t = T && T.get && T.get(tok);
      const val = a.valore ?? a.value ?? a.val ?? a.colore;
      const f = pezziCambi(a);
      if (typeof f[0] === 'string') f[0] = f[0].replace(/^aspetto, /, '');
      if (f.length) return aPezzi('🎨', ['Aspetto · ', ...f]);
      // Senza evento il valore era già quello: si dice come per le preferenze, mai «token = valore» (#557).
      return aPezzi('🎨', [`Aspetto già così · ${(t && t.label) || 'un dettaglio'}`, ...(val ? [': ', suo(val)] : [])]);
    },
    PROXY_TAB: (a) => aPezzi('🌍', ['Scheda aperta da · ', suo(String(a.country || a.paese || '').toUpperCase())]),
    RIMUOVI_PROXY: () => ({ icon: '🌍', text: 'Scheda riportata in Italia' }),
    RIMUOVI_PROXY_TUTTE: () => ({ icon: '🌍', text: 'Tutte le schede riportate in Italia' }),
    REGOLA_PROXY_DOMINIO: (a) => aPezzi('🌍', ['Regola · ', suo(a.dominio || a.domain || a.sito) || 'questo sito', ' sempre da ', suo(String(a.country || a.paese || '').toUpperCase())]),
    RIMUOVI_REGOLA_PROXY: (a) => aPezzi('🌍', ['Regola tolta · ', suo(a.dominio || a.domain || a.sito) || 'questo sito']),
    TIENI_APERTA: (a) => aPezzi('📌', ['Sempre aperto · ', suo((a._output && a._output.sito) || a.dominio || a.sito) || 'questo sito']),
    NON_TENERE_APERTA: (a) => {
      const siti = a._output && Array.isArray(a._output.siti) ? a._output.siti.join(', ') : '';
      return aPezzi('📌', ['Non più tenuto aperto · ', suo(siti || a.dominio || a.sito) || 'questo sito']);
    },
    STILE_PAGINA: (a) => aPezzi('🖌', ['Aspetto della pagina · ', suo(a.descrizione || a.description) || 'modificato']),
    RIPRISTINA_STILE_PAGINA: () => ({ icon: '🖌', text: 'Aspetto della pagina ripristinato' }),
    PULISCI_TAB: (a) => {
      const n = Number(a._output && a._output.archived) || 0;
      return { icon: '🧹', text: n ? `Schede riordinate · ${n} ${n === 1 ? 'archiviata' : 'archiviate'}` : 'Schede riordinate · nessuna da archiviare' };
    },
    CHIUDI_SCHEDE: (a) => {
      const o = a._output || {};
      const n = Number(o.chiuse) || 0;
      const parti = restanoAperte(o);
      // #2086 — una bloccata chiusa perché chiesta per numero.
      const b = Number(o.bloccate) || 0;
      const sblocco = !b ? '' : n === 1 ? ' · era bloccata' : ` · ${b === 1 ? 'una era bloccata' : `${b} erano bloccate`}`;
      const resto = `${sblocco}${parti ? ` · ${parti}` : ''}`;
      if (!n) return { icon: '✕', text: `Nessuna scheda chiusa${resto}`, failed: true };
      return { icon: '✕', text: `${n === 1 ? 'Chiusa una scheda' : `Chiuse ${n} schede`}${resto}` };
    },
    CANCELLA_ARCHIVIO: (a) => {
      const n = Number(a._output && a._output.eliminate) || 0;
      return { icon: '🗑', text: `Eliminate dall’archivio · ${n} ${n === 1 ? 'scheda' : 'schede'}` };
    },
    // Il nome è quello della carta toccata davvero (#870): a sinistra lo dice l'esito, a destra lo si risolve come il
    // main. Le parole del modello da sole ingannano: «l'avviso del documento» contiene un nome dell'Editor.
    CARTA_HOME: (a) => {
      const C = global.SN_CARTE_HOME;
      const o = a._output || {};
      const corto = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 60 ? `${x.slice(0, 59)}…` : x; };
      let nome = '';
      const toccate = Array.isArray(o.tolte) && o.tolte.length ? o.tolte : (Array.isArray(o.rimesse) && o.rimesse.length ? o.rimesse : null);
      if (toccate) nome = toccate.length === 1 ? corto(toccate[0].titolo) : `${toccate.length} carte`;
      else if (o.spostata) nome = corto(o.spostata);
      let tasto = false;
      if (!toccate && !o.spostata && Array.isArray(o.destra) && !o.error && C) {
        const id = C.risolvi(a.carta);
        const def = id ? C.carta(id) || C.tasto(id) : null;
        nome = def ? def.titolo : '';
        tasto = !!(def && C.tasto(id));
      }
      const op = String(a.operazione || '').toLowerCase();
      // Un tasto di «altro» (#2372) tolto va nel «+».
      const cosa = (tasto ? { togli: 'Tasto messo nel «+»', rimetti: 'Tasto rimesso in vista', aggiungi: 'Tasto rimesso in vista', sposta: 'Tasto spostato' }
        : { togli: 'Carta tolta', rimetti: 'Carta rimessa', aggiungi: 'Carta rimessa', sposta: 'Carta spostata' })[op];
      if (op === 'ripristina') return { icon: '🏠', text: 'Carte della home rimesse com\'erano' };
      return { icon: '🏠', text: `${cosa || 'Carta della home'}${nome ? ` · ${nome}` : ''}` };
    },
    // Il nome è quello della voce toccata davvero, che dice l'esito: il modello può averla chiamata in un altro modo.
    BARRA_SITI: (a) => {
      const o = a._output || {};
      const corto = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 60 ? `${x.slice(0, 59)}…` : x; };
      const nome = corto(o.voce || a.elemento || a.voce || a.nome || a.indirizzo);
      // L'operazione e i suoi sinonimi li riconosce solo src/shared/barraSiti.js, caricato anche nella home.
      if (!global.SN_BARRA_SITI && typeof require === 'function') { try { require('./barraSiti.js'); } catch (_) {} }
      const op = global.SN_BARRA_SITI ? global.SN_BARRA_SITI.operazione(a) : '';
      if (op === 'elenca') return { icon: '📌', text: 'Letta la barra dei siti' };
      if (op === 'ripiega' || op === 'riapri') return { icon: '📌', text: op === 'ripiega' ? 'Chat della home ripiegata' : 'Chat della home riaperta' };
      // Una mossa che ha lasciato la barra com'era non si racconta come fatta: come «Sei già nella home», non conta.
      const gia = global.SN_BARRA_SITI ? global.SN_BARRA_SITI.giaCosi(op, o) : '';
      const cosa = gia || { aggiungi: 'Messo nella barra dei siti', togli: 'Tolto dalla barra dei siti', rinomina: 'Rinominato nella barra dei siti', sposta: 'Spostato nella barra dei siti' }[op];
      return aPezzi('📌', [cosa || 'Barra dei siti', ...(nome ? [' · ', suo(nome)] : [])], gia ? { failed: true } : {});
    },
    CANCELLA_PAGINE: (a) => {
      const n = Number(a._output && a._output.cancellate) || 0;
      return { icon: '🗑', text: n ? `Cancellate ${n === 1 ? '1 pagina visitata' : `${n} pagine visitate`}` : 'Nessuna pagina visitata da cancellare' };
    },
    ZOOM_PAGINA: (a) => {
      const p = Number(a._output && a._output.percentuale);
      return { icon: '🔍', text: Number.isFinite(p) && p > 0 ? `Zoom ${globalThis.SN_SISTEMA.alPercento(p)}` : 'Zoom cambiato' };
    },
    // #504 — gli stati sono quelli che la pagina riferisce (SN_TRANSLATE_PAGE.daChat).
    TRADUCI_PAGINA: (a) => {
      const o = a._output || {};
      const frasi = {
        in_corso: 'Traduzione della pagina già in corso', gia_tradotta: 'Pagina già tradotta',
        originale: 'Pagina rimessa nella lingua originale', fermata: 'Traduzione fermata · pagina rimessa com’era',
        niente: 'Pagina già nella lingua originale',
      };
      const partita = o.come === 'ripresa' ? 'Traduzione della pagina ripresa'
        : o.come === 'nuovo' ? 'Traduzione del testo nuovo avviata' : 'Traduzione della pagina avviata';
      return { icon: '🌐', text: frasi[o.traduzione] || partita };
    },
    // #874 — il numero e i nomi veri, quelli che il sistema ha confermato.
    VOLUME: (a) => {
      const o = a._output || {};
      const al = globalThis.SN_SISTEMA.alPercento(o.volume);
      return { icon: '🔊', text: typeof o.volume === 'number' ? `Volume ${al}${o.muto ? ' · muto' : ''}` : 'Volume cambiato' };
    },
    BLUETOOTH: (a) => rigaRadio(a, 'Bluetooth'),
    WIFI: (a) => rigaRadio(a, 'Wi-Fi'),
    BLOCCA_PC: () => ({ icon: '🔒', text: 'Computer bloccato' }),
    // #1621 — l'ordine chiesto e quante icone Windows ha davvero spostato.
    ORDINA_DESKTOP: (a) => {
      const o = a._output || {};
      if (o.vuoto) return { icon: '🖥', text: 'Icone del desktop · nessuna da spostare' };
      const come = pulito(o.detto) || 'in ordine';
      if (o.gia) return { icon: '🖥', text: `Icone del desktop · già ${come}` };
      const n = Number(o.spostate) || 0;
      return { icon: '🖥', text: `Icone del desktop · ${come} · ${n === 1 ? '1 spostata' : `${n} spostate`}` };
    },
    RIMEDIO_CREDITI: (a) => {
      const op = String(a.operazione || '').toLowerCase();
      const r = String(a.rimedio || '').toLowerCase();
      const testi = {
        'applica:modello': 'Modelli più economici', 'annulla:modello': 'Rimessi i modelli di prima',
        'applica:automatiche': 'Funzioni automatiche spente', 'annulla:automatiche': 'Funzioni automatiche riaccese',
      };
      return { icon: '◎', text: testi[`${op}:${r}`] || 'Crediti guardati' };
    },
    // #1619 — quello che il pulsante ha fatto davvero, coi nomi che l'esito conferma.
    PULSANTE_PREFERENZE: (a) => {
      const o = a._output || {};
      const p = String(a.pulsante || '').toLowerCase();
      const coda = o.muto ? ' · volume a zero' : '';
      if (p === 'prova_suono') return { icon: '🔔', text: `Suono degli avvisi${o.etichetta ? ` · ${o.etichetta}` : ''}${coda}` };
      if (p === 'prova_suoneria') return { icon: '⏰', text: `Suoneria di timer e sveglie${o.etichetta ? ` · ${o.etichetta}` : ''}${coda}` };
      if (p === 'prova_voce') return { icon: '🗣', text: `Voce della lettura${o.voce ? ` · ${o.voce}` : ''}` };
      if (p === 'prova_voce_sistema') return { icon: '🗣', text: `Voce di riserva${o.voce ? ` · ${o.voce}` : ''}` };
      if (p === 'ripristina_aspetto') {
        const n = Number(o.ripristinati) || 0;
        return { icon: '🎨', text: n ? `Aspetto di serie · ${n === 1 ? '1 valore cambiato' : `${n} valori cambiati`}` : 'Aspetto di serie' };
      }
      if (p === 'rifai_intervista') return { icon: '👋', text: 'Intervista di benvenuto ricominciata in una home nuova' };
      if (p === 'ripristina_tutto') {
        const n = Number(o.ripristinate) || 0;
        return { icon: '↺', text: n ? `Impostazioni di serie · ${n === 1 ? '1 cambiata' : `${n} cambiate`}` : 'Impostazioni di serie' };
      }
      return { icon: '⚙', text: 'Pulsante delle Preferenze' };
    },
    INSTALLA_AGGIORNAMENTO: (a) => {
      const o = a._output || {};
      if (o.aggiornamento === 'aggiornato') return { icon: '⬇', text: 'Filo è già aggiornato' };
      if (o.aggiornamento === 'pronta') return { icon: '⬇', text: `Versione ${o.versione} pronta` };
      if (o.aggiornamento === 'scarica') return { icon: '⬇', text: `Scarico la versione ${o.versione}` };
      if (o.aggiornamento === 'riavvio') return { icon: '⬇', text: `Riavvio per installare la versione ${o.versione}` };
      if (o.aggiornamento === 'a-mano' && o.versione) return { icon: '⬇', text: `Versione ${o.versione} da scaricare a mano` };
      return { icon: '⬇', text: 'Aggiornamento' };
    },
    COMANDO_FINESTRA: (a) => {
      const labels = {
        fullscreen: 'Schermo intero', minimize: 'Finestra ridotta a icona', home: 'Home aperta',
        settings: 'Impostazioni aperte', apps: 'Menu App aperto', account: 'Menu Account aperto',
        sidebar: 'Barra laterale aperta', sidebar_close: 'Barra laterale chiusa',
        sidebar_lock: 'Barra laterale bloccata aperta', sidebar_unlock: 'Barra laterale sbloccata', aiuto: 'Aiuto aperto',
      };
      const cmd = String(a.comando || a.command || a.cmd || '').toLowerCase();
      // La home chiesta dalla home non ricarica niente (butterebbe via lavoro e
      // risposta), e `failed` tiene fuori dal riassunto un comando che non ha agito.
      if (cmd === 'home' && a._output && a._output.already) return { icon: '🏠', text: 'Sei già nella home', failed: true };
      return { icon: '🪟', text: labels[cmd] || 'Comando della finestra' };
    },
    ACCOUNT: (a) => {
      const o = a._output || {};
      // Chi era già dove chiedeva non ha avuto niente di nuovo: la riga lo dice e resta fuori dal riassunto.
      const gia = Object.hasOwn(GIA_ACCOUNT, o.gia) ? GIA_ACCOUNT[o.gia] : '';
      if (gia) return { icon: '👤', text: gia, failed: true };
      const fatto = { accedi: 'Accesso con Google aperto', collega_google: 'Collegamento di YouTube, Gmail e Drive aperto', esci: 'Uscito dall\'account di Filo' }[o.voce];
      return { icon: '👤', text: fatto || 'Account' };
    },
    SPOSTA_ICONA: (a) => {
      const D = global.SN_DISPOSIZIONE_ICONE;
      const id = String(a.icona || a.id || '');
      // Un'icona che Filo non conosce ha il nome che le ha dato il modello.
      const nome = D && D.esiste && D.esiste(id) ? D.nome(id) : suo(id);
      const zona = D && D.zonaDellAzione ? D.zonaDellAzione(a) : '';
      const dove = zona ? `${D.nomeZona(zona).in} ${D.nomeZona(zona).nome}` : '';
      return aPezzi('📌', ['Icona spostata · ', nome, dove ? ` ${dove}` : '']);
    },
    PANNELLO_APP: (a) => {
      const P = global.SN_PANNELLI_APP;
      const op = String(a.operazione || '').toLowerCase();
      const id = P ? P.risolvi('editor', a.elemento) : null;
      const nome = id ? P.nome('editor', id) : '';
      const testo = {
        apri: 'Pannello degli strumenti aperto', chiudi: 'Pannello degli strumenti chiuso',
        blocca: 'Pannello degli strumenti tenuto aperto', sblocca: 'Pannello degli strumenti sbloccato',
        aggiungi: `Nel pannello degli strumenti · ${nome}`, togli: `Tolto dal pannello degli strumenti · ${nome}`,
      }[op] || 'Pannello degli strumenti';
      return { icon: '🧰', text: testo };
    },
  };
  const GIA_ACCOUNT = { dentro: 'Eri già dentro Filo', collegato: 'YouTube, Gmail e Drive erano già collegati', fuori: 'Non eri dentro nessun account' };
  // Un esito per ogni riga di una mossa senza effetto: le chat salvate prima che la voce la marcasse ne tengono la
  // frase solo come perché, e riaperte la riconoscono da lì (#553.16). Sentinella: tests/unit/esitiInArchivio.test.mjs.
  const PROVE_SENZA_EFFETTO = {
    COMANDO_FINESTRA: [{ comando: 'home', _output: { window: 'home', already: true } }],
    ACCOUNT: Object.keys(GIA_ACCOUNT).map((gia) => ({ _output: { gia } })),
    BARRA_SITI: [
      { operazione: 'aggiungi', _output: { gia: true, invariata: true } },
      ...['rinomina', 'sposta', 'togli'].map((operazione) => ({ operazione, _output: { invariata: true } })),
    ],
    CHIUDI_SCHEDE: ['niente', 'sito'].map((nessuna) => ({ _output: { chiuse: 0, nessuna } })),
  };
  function proveSenzaEffetto(type) {
    return (Object.hasOwn(PROVE_SENZA_EFFETTO, type) ? PROVE_SENZA_EFFETTO[type] : []).map((p) => ({ type, _executed: true, ...p }));
  }
  // Che cosa NON è andato a buon fine, detto come lo direbbe l'utente: la riga
  // del diario resta (è successo qualcosa), ma non promette il contrario.
  const FAILED_LABELS = {
    TIMER: 'Timer non avviato', SVEGLIA: 'Sveglia non impostata',
    CANCELLA_SVEGLIA: 'Niente da cancellare', MODIFICA_SVEGLIA: 'Niente da spostare',
    SALVA_APPUNTO: 'Appunto non salvato', SALVA_LEZIONE: 'Non memorizzato',
    DIMENTICA: 'Niente da dimenticare',
    TOGLI_CHAT: 'Conversazione non trovata', RIMETTI_CHAT: 'Conversazione nascosta non trovata',
    CORREGGI_MEMORIA: 'Niente da correggere',
    CERCA_WEB: 'Ricerca non riuscita', IMMAGINI_WEB: 'Nessuna immagine trovata', GENERA_IMMAGINE: 'Immagine non creata', LEGGI_FILE: 'File non letto', RINOMINA_FILE: 'Nessun file rinominato',
    ELIMINA_FILE: 'Niente cancellato',
    CERCA_CHAT: 'Conversazione non ritrovata', ESPANDI_FILO: 'Filo di quelle ore non riletto',
    LEGGI_DOCUMENTO: 'Documento non letto', LEGGI_TRASPARENZA: 'Documento non disponibile',
    LEGGI_PAGINA: 'Pagina non letta',
    VEDI_SCHERMO: 'Finestra non guardata',
    CERCA_DOCUMENTI: 'Ricerca nei documenti non riuscita', APRI_FILE: 'File non mostrato',
    CERCA_SALVATE: 'Ricerca fra le pagine salvate non riuscita',
    APRI_SALVATA: 'Pagina salvata non aperta',
    SCHEDE_CHIUSE: 'Ricerca fra le schede chiuse non riuscita', RIAPRI_SCHEDA: 'Scheda non riaperta',
    RIPRENDI_AUDIO: 'Musica non ripartita',
    PAUSA_AUDIO: 'Niente messo in pausa', MOSTRA_SCHEDA: 'Scheda non trovata',
    BLOCCA_SCHEDA: 'Scheda non bloccata', SBLOCCA_SCHEDA: 'Scheda non sbloccata',
    SALVA_PER_DOPO: 'Pagina non salvata', CERCA_IMMAGINE: 'Immagine non cercata',
    CAPACITA_DETTAGLIO: 'Verifica non riuscita', NAVIGA: 'Link non aperto', LEGGI_IMPOSTAZIONI: 'Impostazioni non lette',
    LEGGI_MEMORIA: 'Memoria non letta', TOGLI_PERMESSO_SITO: 'Permesso non tolto',
    IMPOSTA_PREFERENZA: 'Impostazione non applicata', IMPOSTA_ESTETICA: 'Aspetto non cambiato',
    ANNULLA_CAMBIO: 'Niente annullato',
    STILE_PAGINA: 'Aspetto della pagina non cambiato', RIPRISTINA_STILE_PAGINA: 'Aspetto della pagina non ripristinato',
    PROXY_TAB: 'Scheda non instradata', RIMUOVI_PROXY: 'Proxy non tolto',
    RIMUOVI_PROXY_TUTTE: 'Proxy non tolti', REGOLA_PROXY_DOMINIO: 'Regola non salvata',
    RIMUOVI_REGOLA_PROXY: 'Regola non tolta', COMANDO_FINESTRA: 'Comando non eseguito', SPOSTA_ICONA: 'Icona non spostata',
    ACCOUNT: 'Account non cambiato',
    PANNELLO_APP: 'Pannello degli strumenti non cambiato',
    TIENI_APERTA: 'Sito non salvato', NON_TENERE_APERTA: 'Nessun sito da togliere',
    INSTALLA_AGGIORNAMENTO: 'Aggiornamento non partito',
    RIMEDIO_CREDITI: 'Rimedio dei crediti non applicato',
    PULSANTE_PREFERENZE: 'Pulsante delle Preferenze non premuto',
    CARTA_HOME: 'Carta della home non cambiata',
    BARRA_SITI: 'Barra dei siti non cambiata',
    CANCELLA_PAGINE: 'Pagine non cancellate', ZOOM_PAGINA: 'Zoom non cambiato', TRADUCI_PAGINA: 'Traduzione non cambiata',
    EVENTO_CALENDARIO: 'Evento non proposto', ONBOARDING: 'Accoglienza non aggiornata',
    VOLUME: 'Volume non cambiato', BLUETOOTH: 'Bluetooth non cambiato', WIFI: 'Wi-Fi non cambiato',
    ORDINA_DESKTOP: 'Icone del desktop non spostate', BLOCCA_PC: 'Computer non bloccato',
    ESEGUI_COMANDO: 'Comando non eseguito', CANCELLA_MEMORIA: 'Memoria non cancellata',
    INVIA_FEEDBACK: 'Segnalazione non inviata',
    PULISCI_TAB: 'Riordino non riuscito', CANCELLA_ARCHIVIO: 'Archivio non svuotato',
    CHIUDI_SCHEDE: 'Nessuna scheda chiusa',
  };
  function rigaRadio(a, radio) {
    const o = a._output || {};
    const icon = radio === 'Wi-Fi' ? '📶' : '🎧';
    if (Array.isArray(o.elenco)) return { icon, text: radio === 'Wi-Fi' ? 'Letto le reti conosciute' : 'Letto i dispositivi abbinati' };
    if (typeof o.acceso === 'boolean') return { icon, text: `${radio} ${o.acceso ? 'acceso' : 'spento'}` };
    // Il nome di un dispositivo o di una rete lo sceglie chi l'ha configurato.
    const nome = suo(o.dispositivo || o.rete);
    const con = (cosa) => aPezzi(icon, [`${cosa} · `, nome]);
    if (o.dimenticato || o.dimenticata) return con(o.dimenticata ? 'Rete dimenticata' : 'Dimenticato');
    if (typeof o.preferito === 'boolean') return con(o.preferito ? 'Fra i preferiti' : 'Tolto dai preferiti');
    if (o.gia) return con('Già così');
    // Il sistema ha preso la richiesta ma non ha ancora confermato: la riga non promette di più.
    if (radio === 'Wi-Fi') return con(o.confermato === false ? 'Collegamento chiesto' : 'Collegato al Wi-Fi');
    if (o.collegato === null) return con('Collegamento chiesto');
    return con(o.collegato === false ? 'Scollegato' : 'Collegato');
  }
  // I nomi delle sveglie toccate li scrive il main con dentro l'etichetta del modello: ognuno nel suo riquadro.
  function nomiSveglie(list, a) {
    const l = list.map(suo).filter(Boolean);
    return l.length ? unisci(l, ', ') : [suo(a.etichetta || a.label)];
  }
  // Si raccontano SOLO col bottone: la riga ripeterebbe ciò che l'utente ha già
  // davanti. Ogni azione sta qui o in ACTIVITY_ROWS: lo pretende una sentinella.
  const SOLO_BOTTONE = ['APRI_FILE', 'NAVIGA', 'ESEGUI_COMANDO'];
  // Detto di un'azione che la regola ha fermato prima di cominciare: dove l'etichetta di sopra parla di un esito.
  const NO_LABELS = {
    ESEGUI_COMANDO: 'Comando non eseguito', DIMENTICA: 'Non dimenticato', CORREGGI_MEMORIA: 'Non corretto',
    TOGLI_CHAT: 'Conversazione non tolta', RIMETTI_CHAT: 'Conversazione non rimessa', ELIMINA_FILE: 'Non cancellato',
    CANCELLA_SVEGLIA: 'Non cancellata', MODIFICA_SVEGLIA: 'Non spostata',
    CANCELLA_MEMORIA: 'Memoria non cancellata', CANCELLA_ARCHIVIO: 'Archivio non svuotato',
    INVIA_FEEDBACK: 'Segnalazione non inviata',
  };
  // Partita e finita male (un comando uscito con errore): «non eseguito» direbbe che non è nemmeno partita.
  const FALLITE_DOPO_PARTENZA = { ESEGUI_COMANDO: 'Comando non riuscito' };
  function etichettaFallita(type, partita) {
    if (partita && Object.hasOwn(FALLITE_DOPO_PARTENZA, type)) return FALLITE_DOPO_PARTENZA[type];
    return Object.hasOwn(FAILED_LABELS, type) ? FAILED_LABELS[type] : '';
  }
  // `no`: non è partita per un no (della regola di autonomia o dell'utente): «Niente da dimenticare» con le righe lì è
  // falso. La stessa scelta per il diario in diretta e per la chat riaperta.
  function etichettaNonFatta(type, { no = false, partita = false } = {}) {
    if (no) return NO_LABELS[type] || FAILED_LABELS[type] || 'Non fatto';
    return etichettaFallita(type, partita);
  }
  // Riordino e svuotamento dell'archivio chiedono col loro pannello: come chiedere lo porta `_domanda` (#530).
  const DOMANDE_PANNELLO = { PULISCI_TAB: 'riordino delle schede', CANCELLA_ARCHIVIO: 'eliminazione dall’archivio' };
  // Titolo e testo di una segnalazione, interi: al passaggio del mouse su ogni suo tasto e riga si legge cosa parte (#1635).
  function testoSegnalazione(a) {
    const S = isType(a, 'INVIA_FEEDBACK') ? segnalazione() : null;
    return S ? S.fumetto(a) : '';
  }
  function rigaAttivita(a) {
    const r = rigaSenzaFumetto(a);
    const testo = r && !r.title ? testoSegnalazione(a) : '';
    return testo ? { ...r, title: testo } : r;
  }
  function rigaSenzaFumetto(a) {
    if (!a) return null;
    // In attesa di conferma: il bottone lo mostra la chat, ma nel diario resta
    // la traccia che Filo l'ha CHIESTO — se no un turno fatto di sola richiesta
    // di conferma non lascia nessun blocco, e alla conferma non c'è più dove
    // scrivere che è stata data.
    if (a._confirm) {
      // Due parole, non l'intera spiegazione: quella sta nel popup, che è
      // aperto davanti all'utente proprio in quel momento.
      // Il testo altrui della domanda resta a pezzi, per il suo riquadro (#592.25).
      const d = global.SN_ESITO.rigaDellaDomanda(a._confirm, 58);
      let prima = d.riga;
      if (prima.length > 60) prima = `${prima.slice(0, 57)}…`;
      const text = `Conferma chiesta · ${prima || String(a.type || '').toLowerCase()}`;
      return { icon: '❔', text, failed: true, ...(d.parti ? { parti: ['Conferma chiesta · ', ...d.parti] } : {}) };
    }
    const type = String(a.type || '').toUpperCase();
    // Un segreto che sarebbe uscito (#810): cosa è stato fermato e da dove veniva, frase del main.
    const fermata = a._output && a._output.blocked === 'segreto' ? String(a._output.frase || '').trim() : '';
    if (fermata) return { icon: '🔒', text: fermata.charAt(0).toUpperCase() + fermata.slice(1), tipo: 'FERMATA' };
    if (a._domanda) return { icon: '❔', text: `Conferma chiesta · ${DOMANDE_PANNELLO[type] || type.toLowerCase()}`, failed: true };
    // Proposta (l'evento di calendario): il main non l'ha eseguita perché tocca
    // al bottone qui sotto, e raccontarla come fallita sarebbe falso.
    if (a._output && a._output.proposta) {
      const fn = ACTIVITY_ROWS[type];
      return fn ? fn(a) : { icon: '•', text: `Proposto · ${type.toLowerCase().replace(/_/g, ' ')}` };
    }
    // Non riuscita: la riga lo DICE, invece di raccontare un successo che non
    // c'è stato (un documento inesistente diceva «Leggo il documento…»).
    if (a._executed === false) {
      const m = global.SN_ESITO.motivoAPezzi(a);
      const perche = Array.isArray(m) ? m : (m ? [m] : []);
      const cosa = etichettaNonFatta(type, { no: rifiutataDallaRegola(a), partita: global.SN_ESITO.partita(a) }) || 'Azione non riuscita';
      return aPezzi('⚠', [cosa, ...(perche.length ? [' · ', ...perche] : [])], { failed: true });
    }
    const fn = ACTIVITY_ROWS[type];
    if (fn) return fn(a);
    if (SOLO_BOTTONE.includes(type)) return null;
    // Rete di sicurezza per un'azione che la tabella non copre: una riga
    // generica invece del silenzio, e mai il nome interno dell'azione.
    if (a._traccia || a._executed) return { icon: '•', text: 'Azione eseguita' };
    return null;
  }
  // «Leggo la pagina: <titolo>». Il titolo lo scrive il sito: una riga sola e corta, e senza titolo si nomina il sito.
  // Il titolo se lo scrive il sito, quindi da solo non dice dove è andato Filo: accanto il sito, e se la pagina era
  // la scheda dell'utente (dentro il suo accesso) lo si dice. L'indirizzo intero sta sotto il puntatore.
  // Il sito lo dice Filo, che sa dove è andato: nel riquadro va solo il titolo.
  function pezziLetturaPagina(a) {
    const o = (a && a._output) || {};
    let titolo = String(o.titolo || '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
    if (titolo.length > 60) titolo = `${titolo.slice(0, 57)}…`;
    let sito = '';
    try { sito = new URL(o.url || a.url || '').hostname.replace(/^www\./, ''); } catch (_) { sito = ''; }
    const seguito = Number(o.da || a.da || 0) > 0;
    const verbo = seguito ? 'Leggo il seguito della pagina' : 'Leggo la pagina';
    const dopo = [suo(titolo), sito !== titolo ? sito : '', o.fonte === 'scheda' ? 'dalla tua scheda' : ''].filter(Boolean);
    return dopo.length ? [`${verbo}: `, ...unisci(dopo, ' · ')] : [verbo];
  }
  const rigaLetturaPagina = (a) => piatto(pezziLetturaPagina(a));
  function indirizzoLetto(a) {
    const o = (a && a._output) || {};
    return String(o.url || (a && a.url) || '').slice(0, 300);
  }
  // Il main ha detto no prima di toccare niente (#530): l'azione non è partita, e il diario non la racconta come fatta.
  function rifiutataDallaRegola(a) {
    return !!(a && a._output && a._output.no);
  }
  function sceltaContatori(a) {
    return isType(a, 'ONBOARDING') && a._executed !== false && !!a._output && a._output.sceltaContatori === true;
  }

  // #1188, #1589 — nell'intervista Filo mostra i livelli di autonomia o di privacy e l'utente sceglie: la scelta la
  // disegna l'accoglienza.
  function sceltaAutonomia(a) {
    return isType(a, 'ONBOARDING') && a._executed !== false && !!a._output
      && (a._output.sceltaAutonomia === true || a._output.sceltaPrivacy === true);
  }

  // «Cercato fra i documenti · bolletta luce marzo · 8 trovati»: dice anche quando la ricerca è stata fermata.
  function pezziRicercaDocumenti(a) {
    const o = (a && a._output) || {};
    const q = String((a && (a.cosa || a.query)) || o.cercato || '').trim();
    const breve = suo(q.length > 60 ? `${q.slice(0, 59)}…` : q);
    if (o.cartellaMancante) return ['Cartella non trovata · ', suo(o.cartellaMancante)];
    if (o.cartellaDiRete) return ['Cartella su un altro computer · ', suo(o.cartellaDiRete)];
    const n = Array.isArray(o.risultati) ? o.risultati.length : null;
    const quanti = n == null ? '' : (n ? ` · ${n === 1 ? 'uno trovato' : `${n} trovati`}` : ' · nessuno trovato');
    return ['Cercato fra i documenti', ...(breve ? [' · ', breve] : []), `${quanti}${o.fermata ? ' · fermata da te' : ''}`];
  }
  const testoRicercaDocumenti = (a) => piatto(pezziRicercaDocumenti(a));

  function pezziRicercaSalvate(a) {
    const o = (a && a._output) || {};
    const q = pulito(a && (a.cerca || a.query)) || pulito(o.cercato);
    const breve = suo(q.length > 60 ? `${q.slice(0, 59)}…` : q);
    const n = Number.isInteger(o.trovate) ? o.trovate : (Array.isArray(o.pagine) ? o.pagine.length : null);
    const quante = n == null ? '' : (n ? ` · ${n === 1 ? 'una trovata' : `${n} trovate`}` : ' · nessuna trovata');
    return ['Cercato fra le pagine salvate', ...(breve ? [' · ', breve] : []), quante];
  }
  const testoRicercaSalvate = (a) => piatto(pezziRicercaSalvate(a));

  function testoRinominati(o) {
    const n = o && Array.isArray(o.rinominati) ? o.rinominati.length : 0;
    const no = o && Array.isArray(o.falliti) ? o.falliti.length : 0;
    const quanti = n === 1 ? 'Rinominato un file' : `Rinominati ${n} file`;
    return no ? `${quanti} · ${no} non riusciti` : quanti;
  }
  // #1909 — i nomi vengono dal disco: entrano solo come testo.
  function pezziEliminati(o) {
    const fatti = o && Array.isArray(o.eliminati) ? o.eliminati.map(pulito) : [];
    const no = o && Array.isArray(o.falliti) ? o.falliti.length : 0;
    const per = !!(o && o.perSempre);
    const quanti = fatti.length === 1
      ? [`${per ? 'Cancellato per sempre' : 'Nel cestino'} `, fra(fatti[0]) || '«»']
      : [`${per ? 'Cancellati per sempre' : 'Nel cestino'} ${fatti.length} elementi`];
    return no ? [...quanti, ` · ${no} non riusciti`] : quanti;
  }
  const testoEliminati = (o) => piatto(pezziEliminati(o));

  // Le azioni che in diretta sono solo il loro bottone: nella chat riaperta (#1294) una riga al passato con la cosa vera.
  const DOPO_IL_BOTTONE = {
    NAVIGA: (a) => {
      const u = suo(a.url || a.href || a.link || a.indirizzo);
      return u ? aPezzi('🌐', ['Aperta · ', u]) : { icon: '🌐', text: 'Pagina aperta' };
    },
    APRI_FILE: (a) => {
      const f = suo(pulito(a.percorso || a.path).split(/[\\/]/).pop());
      return f ? aPezzi('📄', ['File mostrato · ', f]) : { icon: '📄', text: 'File mostrato' };
    },
    ESEGUI_COMANDO: (a) => {
      const c = pulito(a.comando ?? a.command ?? a.cmd);
      return aPezzi('⌨', ['Comando eseguito', ...(c ? [' · ', suo(c.length > 80 ? `${c.slice(0, 79)}…` : c)] : [])]);
    },
  };
  function rigaArchivio(a) {
    const r = rigaAttivita(a);
    if (r) return r;
    const fn = a && DOPO_IL_BOTTONE[String(a.type || '').toUpperCase()];
    return fn ? fn(a) : null;
  }

  global.SN_RIGHE_ATTIVITA = {
    riga: rigaAttivita, rigaArchivio, proveSenzaEffetto, testoSegnalazione, pulito, FAILED_LABELS, etichettaFallita, etichettaNonFatta, NO_LABELS, SOLO_BOTTONE, DOMANDE_PANNELLO, rigaLetturaPagina, indirizzoLetto,
    rifiutataDallaRegola, sceltaContatori, sceltaAutonomia, testoRicercaDocumenti, testoRicercaSalvate, testoRinominati, testoEliminati,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
