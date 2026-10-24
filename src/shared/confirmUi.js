// Componenti di conferma riusabili per i livelli di sicurezza delle azioni
// di Filo (#146.2). Stile minimale, costruito sui token del tema (--sn-*).
//
//   SN_CONFIRM_UI.confirm({ title, text, parti, okLabel, cancelLabel, altroLabel }) → Promise<bool | 'altro'>
//     Livello 2: popup che SPIEGA in chiaro la modifica, con OK e Annulla.
//     `parti` (facoltativo, vince su `text`): stringhe di Filo e riquadri
//     { citazione } / { elenco } col testo che non è suo (#592.7).
//     `altroLabel`: un secondo sì, diverso da OK, che risolve 'altro'; solo nelle pagine di Filo.
//
//   SN_CONFIRM_UI.confirmTyped({ title, text, word, avviso }) → Promise<bool>
//     Livello 3: box con attrito maggiore — il bottone resta disabilitato
//     finché l'utente non digita espressamente la parola ("conferma").
//
// Esc o click fuori dal box = annulla (il click fuori solo dopo il primo mezzo secondo). Una sola conferma alla volta.
// `coprePagina`: la domanda è sulla pagina stessa (sito pericoloso) — la
// copre, rispondono solo i bottoni, e i tasti non tornano alla pagina.
// `segnale` (AbortSignal) ritira la domanda: risolve false.
//
// SICUREZZA: su una pagina web il popup NON sta nel documento del sito, che
// potrebbe nasconderlo e disegnarci sopra un testo diverso (#592.6): lo
// disegna il main in una vista sopra la scheda (src/main/confermeSopraPagina.js),
// e da qui parte solo la domanda. Dove il documento è di Filo il popup sta
// nella pagina, in uno Shadow DOM CHIUSO (#249): il bottone OK non si trova
// né si clicca da uno script. Regole:
// patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

(function (global) {
  'use strict';

  const CSS = `
.sn-confirm-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  font-family: var(--sn-font);
}
/* Avviso sulla pagina stessa: finché non si sceglie, la pagina non si vede. */
.sn-confirm-overlay.sn-confirm-copre { background: rgba(28, 14, 8, 0.92); }
.sn-confirm-box {
  width: min(440px, calc(100vw - 48px));
  padding: 20px;
  background: var(--sn-overlay-bg, var(--sn-bg, #fff));
  color: var(--sn-fg, #1a1918);
  border: 1px solid var(--sn-border, #e0dcd4);
  border-radius: var(--sn-radius, 6px);
  box-shadow: var(--sn-shadow, 0 4px 16px rgba(0,0,0,0.18));
}
.sn-confirm-box:focus { outline: none; }
.sn-confirm-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.sn-confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--sn-fg, #1a1918);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* Un testo lungo non si taglia: scorre, e OK aspetta che sia passato tutto
     sotto gli occhi (tuttoVisto). Il tetto lascia posto a titolo e bottoni. */
  max-height: min(640px, calc(100vh - 160px));
  overflow-y: auto;
}
.sn-confirm-filo { margin: 0; }
/* Il testo che non è di Filo sta su un foglietto tinto d'accento, con un filo a
   sinistra che le parole di Filo non hanno. Il filo è per metà colore del testo:
   l'accento lo cambiano il modello e le pagine, e chi spegne il filo spegne le parole. */
.sn-confirm-quote {
  margin: 6px 0 10px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--sn-accent, #c45a3b) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--sn-accent, #c45a3b) 30%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--sn-accent, #c45a3b) 50%, currentColor);
  border-radius: var(--sn-radius, 6px);
}
.sn-confirm-quote:last-child { margin-bottom: 0; }
.sn-confirm-quote-voce + .sn-confirm-quote-voce {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--sn-accent, #c45a3b) 22%, transparent);
}
.sn-confirm-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 16px;
  padding: 8px 10px;
  font-family: var(--sn-font);
  font-size: 13px;
  color: var(--sn-fg, #1a1918);
  background: var(--sn-bg, #fff);
  border: 1px solid var(--sn-border, #e0dcd4);
  border-radius: var(--sn-radius, 6px);
  outline: none;
}
.sn-confirm-input:focus { border-color: var(--sn-accent, #c45a3b); }
.sn-confirm-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.sn-confirm-btn {
  all: unset;
  box-sizing: border-box;
  padding: 8px 14px;
  font-family: var(--sn-font);
  font-size: 13px;
  border-radius: var(--sn-radius, 6px);
  cursor: pointer;
  text-align: center;
}
.sn-confirm-btn-cancel,
.sn-confirm-btn-altro {
  color: var(--sn-fg, #1a1918);
  border: 1px solid var(--sn-border, #e0dcd4);
}
.sn-confirm-btn-cancel:hover,
.sn-confirm-btn-altro:hover { background: var(--sn-hover, rgba(0,0,0,0.05)); }
.sn-confirm-btn-ok {
  background: var(--sn-btn-bg, var(--sn-fg, #1a1918));
  color: var(--sn-btn-fg, var(--sn-bg, #fff));
  border: 1px solid transparent;
}
.sn-confirm-btn-ok:hover { opacity: 0.85; }
.sn-confirm-btn-danger {
  background: var(--sn-error, #b91c1c);
  color: #fff;
  border: 1px solid transparent;
}
.sn-confirm-btn-danger:hover { opacity: 0.85; }
.sn-confirm-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
/* OK in attesa del testo non ancora visto: grigio come un bottone spento, ma il
   clic fa scorrere il testo, quindi il puntatore resta quello di un bottone. */
.sn-confirm-btn[aria-disabled="true"] { opacity: 0.45; }
.sn-confirm-btn[aria-disabled="true"]:hover { opacity: 0.6; }
.sn-confirm-text {
  scrollbar-width: thin;
  scrollbar-color: var(--sn-border, #e0dcd4) transparent;
}
.sn-confirm-text::-webkit-scrollbar { width: 8px; }
.sn-confirm-text::-webkit-scrollbar-track { background: transparent; }
.sn-confirm-text::-webkit-scrollbar-thumb {
  background: var(--sn-border, #e0dcd4);
  border-radius: 999px;
}
.sn-confirm-text::-webkit-scrollbar-thumb:hover { background: var(--sn-accent, #c45a3b); }
.sn-confirm-text::-webkit-scrollbar-button { display: none; width: 0; height: 0; }

/* Selezione del testo nella palette Filo, non nel blu di sistema.
   La regola ::selection del tema (src/styles/theme.css) sta nel foglio del
   DOCUMENTO e non entra in questo shadow root chiuso: senza queste righe,
   selezionare il testo del popup — cosa che si fa per rileggerlo o copiarlo —
   lo evidenzia col blu del sistema operativo, l'unico punto della UI di Filo
   fuori palette. I custom properties invece attraversano il confine dello
   shadow DOM, quindi i token del tema (e gli override estetici dell'utente)
   valgono anche qui; il letterale resta come ripiego per il primo paint. */
.sn-confirm-overlay ::selection,
.sn-confirm-overlay::selection {
  background: var(--sn-selection-bg, rgba(196, 90, 59, 0.30));
  color: var(--sn-selection-fg, inherit);
}
.sn-confirm-overlay ::-moz-selection,
.sn-confirm-overlay::-moz-selection {
  background: var(--sn-selection-bg, rgba(196, 90, 59, 0.30));
  color: var(--sn-selection-fg, inherit);
}
`;

  // Dialogo attivo (uno alla volta): il root CHIUSO è raggiungibile solo da
  // questo modulo. `active` serve a done() e agli hook di test qui sotto.
  let active = null; // { host, root, done }
  let aperteFuori = 0;

  // Chi batteva un carattere in un campo un attimo fa sta scrivendo: un popup che
  // si apre in quel momento gli lascia i tasti nel suo campo (#592). L'Invio che
  // spedisce e i tasti dati a un popup no: dopo, l'utente aspetta Filo.
  let ultimoTasto = -Infinity;
  try {
    global.document.addEventListener('keydown', (e) => {
      if (!e.isTrusted || active || aperteFuori || !scrivibile(e.target)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) ultimoTasto = -Infinity;
      else if (e.key && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) ultimoTasto = performance.now();
    }, true);
  } catch (_) {}
  const STA_SCRIVENDO_MS = 2000;
  const RITARDO_SI_MS = 500;

  // Costruisce host+shadow(closed)+overlay+box e ritorna { overlay, box, done }
  // dove done(result) smonta tutto e risolve la Promise una sola volta.
  // `ospite` c'è solo nella vista sopra la scheda: il campo di chi scriveva sta
  // nella pagina sotto, e i tasti gli arrivano da `ospite.tasto`.
  function buildOverlay(resolve, ospite, opzioni = {}) {
    const doc = global.document;
    const copre = !!(opzioni && opzioni.coprePagina);

    // L'host è l'UNICO nodo visibile dal documento: nessun contenuto, solo il posizionamento,
    // inline per non dover mettere CSS nel documento del sito.
    const host = doc.createElement('div');
    host.className = 'sn-confirm-host';
    // Marcato: chi cammina sulla pagina (la traduzione, l'Esc a tutto schermo) lo sa di Filo.
    global.SN_FILO_UI?.mark(host);
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';

    const root = global.SN_FILO_UI?.ombra ? global.SN_FILO_UI.ombra(host) : host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const overlay = doc.createElement('div');
    overlay.className = copre ? 'sn-confirm-overlay sn-confirm-copre' : 'sn-confirm-overlay';
    const box = doc.createElement('div');
    box.className = 'sn-confirm-box';
    overlay.appendChild(box);
    root.appendChild(overlay);

    // Il popup si apre anche mentre l'utente scrive in chat: quello che batte
    // finisce nel suo campo, non nel vuoto, e alla chiusura il fuoco torna lì.
    // Non se la domanda è sulla pagina: la password che si batteva non deve finire nel sito dell'avviso.
    const prima = ospite ? null : campoAttivo(doc);
    const inoltra = copre ? null : ospite ? (ospite.campo && ospite.tasto) || null : (scrivibile(prima) ? (t) => applicaTasto(prima, t) : null);
    box.addEventListener('keydown', (e) => {
      if (e.target !== box || !inoltra || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 && e.key !== 'Backspace') return;
      if (inoltra(e.key) === false) return;
      e.preventDefault();
    });

    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('visibilitychange', onVisibile);
      host.remove();
      if (active && active.root === root) active = null;
      if (prima && prima.isConnected) { try { prima.focus({ preventScroll: true }); } catch (_) {} }
      resolve(result);
    }
    // Sulla pagina stessa entrambe le risposte fanno qualcosa (resta o esce): le danno solo i bottoni.
    function onKey(e) {
      if (e.key === 'Escape' && !copre) { e.preventDefault(); e.stopPropagation(); done(false); }
    }
    doc.addEventListener('keydown', onKey, true);
    // Un clic sul velo di un avviso non toglie il fuoco al campo della parola. Il clic fuori di un gesto già partito
    // (il secondo di un doppio clic sul pulsante, un clic mentre il riquadro compare da solo) non annulla: vale la stessa
    // pausa del sì (#449, #1296). Esc e Annulla restano immediati.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target !== overlay) return;
      if (copre) e.preventDefault();
      else if (!troppoPresto(e)) done(false);
    });
    const segnale = opzioni && opzioni.segnale;
    if (segnale && typeof segnale.addEventListener === 'function') segnale.addEventListener('abort', () => done(false), { once: true });

    doc.body.appendChild(host);
    active = { host, root, done };

    // Un popup si apre anche da solo, sotto un gesto già partito per altro (#592):
    // per mezzo secondo da quando si vede un clic o un invio veri non valgono come
    // sì. Si conta dal primo fotogramma disegnato, e da capo quando la scheda torna
    // visibile: un popup nato in una scheda dietro si vede solo lì. I clic del
    // codice (gli hook _test) non arrivano da una pagina: lo shadow root è chiuso.
    let visibileDa = Infinity;
    function onVisibile() {
      visibileDa = Infinity;
      if (doc.visibilityState === 'hidden') return;
      if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(() => { visibileDa = performance.now(); });
      else visibileDa = performance.now();
    }
    doc.addEventListener('visibilitychange', onVisibile);
    onVisibile();
    const troppoPresto = (e) => !!(e && e.isTrusted) && !(performance.now() - visibileDa >= RITARDO_SI_MS);
    active.pronto = () => !troppoPresto({ isTrusted: true });
    // Chi stava scrivendo continua a scrivere nel suo campo: il fuoco va al
    // riquadro, che gli gira i tasti, e non al bottone o al campo del popup.
    const scriveva = !copre && (ospite ? !!ospite.scriveva : staScrivendo(prima));
    const fuoco = (bersaglio) => {
      const el = scriveva ? box : bersaglio;
      if (el === box) box.tabIndex = -1;
      el.focus();
    };
    return { overlay, box, done, troppoPresto, fuoco };
  }

  function header(box, { title, parti }) {
    const doc = global.document;
    if (title) {
      const h = doc.createElement('div');
      h.className = 'sn-confirm-title';
      h.textContent = title;
      box.appendChild(h);
    }
    const p = doc.createElement('div');
    p.className = 'sn-confirm-text';
    if (parti.some(riquadro)) riempi(p, parti);
    else p.textContent = parti.join('');
    box.appendChild(p);
  }

  const riquadro = (x) => !!x && typeof x === 'object' && (Array.isArray(x.elenco) || x.citazione != null);
  function partiDi(text, parti) {
    const buone = Array.isArray(parti) ? parti.filter((x) => typeof x === 'string' || riquadro(x)) : [];
    return buone.length ? buone : [String(text ?? '')];
  }
  // Le parti nella forma che attraversa il canale verso la vista sopra la scheda:
  // solo stringhe e riquadri, coi testi interi. La stessa regola la rifà il main.
  function partiPerFuori(parti) {
    if (!Array.isArray(parti)) return null;
    const out = [];
    for (const x of parti) {
      if (typeof x === 'string') out.push(x);
      else if (riquadro(x) && Array.isArray(x.elenco)) out.push({ elenco: x.elenco.map((v) => String(v ?? '')) });
      else if (riquadro(x)) out.push(x.nuda === true ? { citazione: String(x.citazione), nuda: true } : { citazione: String(x.citazione) });
    }
    return out.length ? out : null;
  }

  // Il testo che non è di Filo va in un elemento suo, riempito con textContent:
  // il bordo lo chiude il DOM, non un carattere (#592.7). Gli a capo accanto a un
  // riquadro li fa il riquadro stesso.
  function riempi(el, parti) {
    const doc = global.document;
    const fuse = [];
    for (const x of parti) {
      if (typeof x === 'string' && typeof fuse[fuse.length - 1] === 'string') fuse[fuse.length - 1] += x;
      else fuse.push(x);
    }
    fuse.forEach((x, i) => {
      if (typeof x === 'string') {
        let s = x;
        if (riquadro(fuse[i - 1])) s = s.replace(/^\s+/, '');
        if (riquadro(fuse[i + 1])) s = s.replace(/\s+$/, '');
        if (!s) return;
        const t = doc.createElement('div');
        t.className = 'sn-confirm-filo';
        t.textContent = s;
        el.appendChild(t);
        return;
      }
      const q = doc.createElement('div');
      q.className = 'sn-confirm-quote';
      for (const v of Array.isArray(x.elenco) ? x.elenco : [x.citazione]) {
        const r = doc.createElement('div');
        r.className = 'sn-confirm-quote-voce';
        r.textContent = String(v ?? '');
        q.appendChild(r);
      }
      el.appendChild(q);
    });
  }

  function campoAttivo(doc) {
    return doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  }

  function staScrivendo(campo) {
    return scrivibile(campo) && performance.now() - ultimoTasto < STA_SCRIVENDO_MS;
  }

  // Un tasto dato al popup entra nel campo di chi scriveva; false se non c'entra.
  function applicaTasto(campo, tasto) {
    const s = campo.selectionStart;
    const f = campo.selectionEnd;
    try {
      if (tasto.length === 1) campo.setRangeText(tasto, s, f, 'end');
      else if (tasto === 'Backspace' && (s > 0 || f > s)) campo.setRangeText('', s === f ? s - 1 : s, f, 'end');
      else return false;
    } catch (_) { return false; }
    const ev = new Event('input', { bubbles: true });
    campo.dispatchEvent(global.SN_FILO_UI?.nostro ? global.SN_FILO_UI.nostro(ev) : ev);
    return true;
  }

  // Su una pagina web il preload dà SN_CONFERMA_FUORI: la domanda va al main, che
  // la disegna sopra la scheda; qui restano il campo di chi scriveva e il suo fuoco.
  function fuori(tipo, opts) {
    const doc = global.document;
    const segnale = opts && opts.segnale;
    if (segnale && segnale.aborted) return Promise.resolve(false);
    const copre = !!(opts && opts.coprePagina);
    const prima = campoAttivo(doc);
    const campo = !copre && scrivibile(prima);
    const richiesta = { tipo, scriveva: !copre && staScrivendo(prima), campo };
    for (const k of ['title', 'text', 'okLabel', 'cancelLabel', 'word', 'avviso']) {
      if (opts && opts[k] != null) richiesta[k] = String(opts[k]);
    }
    for (const k of BANDIERE) if (opts && opts[k] === true) richiesta[k] = true;
    const parti = partiPerFuori(opts && opts.parti);
    if (parti) richiesta.parti = parti;
    const suTasto = (t) => { if (campo && prima.isConnected && typeof t === 'string') applicaTasto(prima, t); };
    aperteFuori++;
    let attesa;
    try { attesa = Promise.resolve(global.SN_CONFERMA_FUORI(richiesta, suTasto, segnale)); } catch (_) { attesa = Promise.resolve(false); }
    return attesa.then((ok) => ok === true, () => false).then((ok) => {
      aperteFuori--;
      if (prima && prima.isConnected) { try { prima.focus({ preventScroll: true }); } catch (_) {} }
      return ok;
    });
  }

  const daFuori = (ospite) => !ospite && typeof global.SN_CONFERMA_FUORI === 'function';
  const BANDIERE = ['coprePagina', 'reversibile'];

  function scrivibile(el) {
    if (!el || el.disabled || el.readOnly) return false;
    return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|tel|password)?$/i.test(el.getAttribute('type') || ''));
  }

  // Si conferma quello che si è visto (#592): se il testo non sta nel riquadro,
  // `visto()` resta falso finché non lo si fa scorrere fino in fondo. È la regola
  // sul riquadro, non su un carattere: righe innocue o disegnate vuote non
  // possono più tenere sotto il bordo l'istruzione e i rischi.
  function tuttoVisto(box, onCambio) {
    const el = box.querySelector('.sn-confirm-text');
    let visto = false;
    const visto_ = () => {
      if (!visto && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) visto = true;
      return visto;
    };
    if (!visto_()) {
      el.tabIndex = 0;
      el.addEventListener('scroll', onCambio, { passive: true });
      if (typeof global.ResizeObserver === 'function') new global.ResizeObserver(onCambio).observe(el);
    }
    // Il clic su OK prima della fine porta avanti il testo di una pagina: un
    // bottone che non risponde sembra rotto, e il perché stava solo nel title.
    const avanti = () => el.scrollBy({ top: Math.max(el.clientHeight - 24, 24), behavior: globalThis.SN_THEME_TOKENS?.scrollBehavior(document) || 'smooth' });
    return { visto: visto_, avanti };
  }

  function inAttesa(btn, attesa) {
    if (attesa) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.title = attesa ? 'Scorri fino in fondo per confermare' : '';
  }

  function buttonRow(box) {
    const row = global.document.createElement('div');
    row.className = 'sn-confirm-row';
    box.appendChild(row);
    return row;
  }

  function makeBtn(row, label, className) {
    const btn = global.document.createElement('button');
    btn.type = 'button';
    btn.className = `sn-confirm-btn ${className}`;
    btn.textContent = label;
    row.appendChild(btn);
    return btn;
  }

  // Livello 2 — popup di conferma con spiegazione + OK/Annulla.
  function confirm(opts = {}, ospite = null) {
    if (daFuori(ospite)) return fuori('confirm', opts);
    const { title = 'Conferma', text = '', parti = null, okLabel = 'OK', cancelLabel = 'Annulla', altroLabel = '' } = opts || {};
    return new Promise((resolve) => {
      const { box, done, troppoPresto } = buildOverlay(resolve, ospite, opts);
      header(box, { title, parti: partiDi(text, parti) });
      const row = buttonRow(box);
      const cancel = makeBtn(row, cancelLabel, 'sn-confirm-btn-cancel');
      // Anche il secondo sì aspetta il testo letto e il mezzo secondo, come OK.
      const si = [[okLabel, 'sn-confirm-btn-ok', true]];
      if (altroLabel) si.unshift([String(altroLabel), 'sn-confirm-btn-altro', 'altro']);
      const bottoni = si.map(([label, classe, esito]) => {
        const b = makeBtn(row, label, classe);
        b.addEventListener('click', (e) => {
          if (!visto()) avanti();
          else if (!troppoPresto(e)) done(esito);
        });
        return b;
      });
      const aggiorna = () => { for (const b of bottoni) inAttesa(b, !visto()); };
      const { visto, avanti } = tuttoVisto(box, aggiorna);
      cancel.addEventListener('click', () => done(false));
      aggiorna();
      // Mai il fuoco su OK, nemmeno se nessuno scriveva: il popup si apre anche
      // da solo, e il primo spazio o invio lo confermerebbe senza leggerlo (#592).
      box.tabIndex = -1;
      box.focus();
    });
  }

  // Livello 3 — l'utente deve digitare la parola (default "conferma") per
  // sbloccare il bottone. Per azioni irreversibili.
  // `avviso` sostituisce la frase sull'irreversibilità quando a chiedere la parola è altro (una difesa abbassata).
  function confirmTyped(opts = {}, ospite = null) {
    if (daFuori(ospite)) return fuori('typed', opts);
    const { title = 'Conferma richiesta', text = '', parti = null, word = 'conferma', okLabel = 'Esegui', cancelLabel = 'Annulla', avviso = '' } = opts || {};
    return new Promise((resolve) => {
      const doc = global.document;
      const { box, done, troppoPresto, fuoco } = buildOverlay(resolve, ospite, opts);
      const perche = String(avviso || '').trim() || (opts && opts.reversibile ? '' : 'Questa azione non è reversibile.');
      header(box, { title, parti: [...partiDi(text, parti), `\n\n${perche ? `${perche} ` : ''}Scrivi “${word}” per procedere.`] });

      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'sn-confirm-input';
      input.placeholder = word;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      box.appendChild(input);

      const row = buttonRow(box);
      const cancel = makeBtn(row, cancelLabel, 'sn-confirm-btn-cancel');
      const ok = makeBtn(row, okLabel, 'sn-confirm-btn-danger');
      ok.disabled = true;

      const parola = () => input.value.trim().toLowerCase() === String(word).toLowerCase();
      const aggiorna = () => {
        ok.disabled = !parola();
        inAttesa(ok, parola() && !visto());
      };
      const { visto, avanti } = tuttoVisto(box, aggiorna);
      const premi = (e) => {
        if (!parola()) return;
        if (!visto()) avanti();
        else if (!troppoPresto(e)) done(true);
      };
      input.addEventListener('input', aggiorna);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); premi(e); }
      });
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', premi);
      fuoco(input);
    });
  }

  // Avviso a un solo bottone — comunica qualcosa senza chiedere una scelta
  // (es. "Hai ricevuto N crediti in regalo 🎁"). Risolve quando l'utente chiude.
  function notify(opts = {}, ospite = null) {
    if (daFuori(ospite)) return fuori('notify', opts);
    const { title = '', text = '', parti = null, okLabel = 'OK' } = opts || {};
    return new Promise((resolve) => {
      const { box, done, troppoPresto, fuoco } = buildOverlay(resolve, ospite, opts);
      header(box, { title, parti: partiDi(text, parti) });
      const row = buttonRow(box);
      const ok = makeBtn(row, okLabel, 'sn-confirm-btn-ok');
      ok.addEventListener('click', (e) => { if (!troppoPresto(e)) done(true); });
      fuoco(ok);
    });
  }

  // ── Hook di TEST (tests/helpers/confirm.mjs) ─────────────────────────────
  // Il root chiuso rende il dialogo invisibile ai locator Playwright: gli spec
  // passano da qui via page.evaluate, sulle pagine filo:// e nella vista sopra
  // la scheda. Nessun sito li raggiunge: sulle pagine web il modulo vive nel
  // mondo isolato del preload, e il dialogo non è nel loro documento.
  const _test = {
    state() {
      if (!active) return null;
      const q = (s) => active.root.querySelector(s);
      const okBtn = q('.sn-confirm-btn-ok') || q('.sn-confirm-btn-danger');
      const textEl = q('.sn-confirm-text');
      // Scorrimento del testo lungo e colore della selezione vivono nel root chiuso:
      // solo da qui uno spec può ispezionarli.
      let selectionBg = '';
      try {
        if (textEl) selectionBg = global.getComputedStyle(textEl, '::selection').backgroundColor || '';
      } catch (_) {}
      // Cosa sta nei riquadri e cosa fuori: le parole di Filo non devono
      // contenere il testo del modello, e il riquadro deve vedersi (#592.7).
      const quote = Array.from(active.root.querySelectorAll('.sn-confirm-quote'));
      const voci = (el) => Array.from(el.children).map((c) => c.textContent).join('\n');
      const pezzi = textEl ? Array.from(textEl.childNodes) : [];
      const primo = quote[0] ? global.getComputedStyle(quote[0]) : null;
      const box = q('.sn-confirm-box');
      return {
        title: (q('.sn-confirm-title') && q('.sn-confirm-title').textContent) || '',
        text: pezzi.map((n) => (n.nodeType === 1 && n.classList.contains('sn-confirm-quote') ? voci(n) : n.textContent)).join('\n'),
        citazioni: quote.map(voci),
        fuori: pezzi.filter((n) => !(n.nodeType === 1 && n.classList.contains('sn-confirm-quote'))).map((n) => n.textContent).join('\n'),
        riquadro: primo ? {
          bg: primo.backgroundColor,
          bordo: primo.borderLeftColor,
          bordoSinistro: primo.borderLeftWidth,
          bgBox: box ? global.getComputedStyle(box).backgroundColor : '',
          font: box ? global.getComputedStyle(box).fontFamily : '',
        } : null,
        okDisabled: !!(okBtn && (okBtn.disabled || okBtn.getAttribute('aria-disabled') === 'true')),
        textScrollTop: textEl ? textEl.scrollTop : 0,
        hasInput: !!q('.sn-confirm-input'),
        copre: !!q('.sn-confirm-copre'),
        okLabel: (okBtn && okBtn.textContent) || '',
        altroLabel: (q('.sn-confirm-btn-altro') && q('.sn-confirm-btn-altro').textContent) || '',
        cancelLabel: (q('.sn-confirm-btn-cancel') && q('.sn-confirm-btn-cancel').textContent) || '',
        // Un clic o un tasto veri adesso varrebbero: il primo fotogramma può
        // arrivare ben dopo che il riquadro sta nel DOM (#592.11).
        pronto: !!(active.pronto && active.pronto()),
        textScrolls: !!(textEl && textEl.scrollHeight > textEl.clientHeight + 1),
        selectionBg,
        // Un sì vero (clic o invio) vale solo da qui: prima è il gesto partito per altro (#592).
        pronto: !!(active.pronto && active.pronto()),
      };
    },
    // Clicca un bottone: which = 'ok' | 'cancel' | 'danger' | 'altro'.
    // Ritorna false se non c'è dialogo, bottone assente o disabilitato.
    click(which) {
      if (!active) return false;
      const btn = active.root.querySelector('.sn-confirm-btn-' + which);
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
      btn.click();
      return true;
    },
    // Centro di un bottone, per un clic vero del mouse (anche su OK in attesa).
    point(which) {
      if (!active) return null;
      const btn = active.root.querySelector('.sn-confirm-btn-' + which);
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    // Fa scorrere il testo fino in fondo, come chi lo legge tutto.
    scrollToEnd() {
      if (!active) return false;
      const el = active.root.querySelector('.sn-confirm-text');
      if (!el) return false;
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
      return true;
    },
    // Scrive nel campo del dialogo livello 3 (dispatch dell'evento input).
    fill(value) {
      if (!active) return false;
      const input = active.root.querySelector('.sn-confirm-input');
      if (!input) return false;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
  };

  // Toglie il popup aperto come un Annulla: la vista sopra la scheda lo fa quando
  // la domanda a schermo cambia o la sua scheda va dietro.
  function chiudi() {
    if (active) active.done(false);
  }

  global.SN_CONFIRM_UI = { confirm, confirmTyped, notify, chiudi, _test };
})(typeof globalThis !== 'undefined' ? globalThis : self);
