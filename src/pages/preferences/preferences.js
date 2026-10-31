// Preferenze: tema, dimensione del testo, commento home, stile dell'agente. Niente pulsante
// «Salva»: ogni modifica si applica e si persiste subito, con un breve «Salvato».

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const { AGENT_STYLE_PRESETS, AGENT_STYLE_MAX, agentStyleLength, testoLeggibile, dictationTimes, opzioniBarraLaterale, opzioniPannelloDestro, opzioniAvvisoSchermoPieno, tempiCorrettore, soglieCorrettore } = window.SN_CONST;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;
  const Tokens = window.SN_THEME_TOKENS;
  const TabColor = window.SN_TAB_COLOR;

  const CUSTOM_KEY = '__custom__';

  function $(id) { return document.getElementById(id); }
  // I numeri che la pagina scrive: 1.234 e 1,5 (regola in tests/unit/numeriItaliani.test.mjs).
  const cifre = (n) => Number(n).toLocaleString('it-IT', { useGrouping: true });

  // Nessuna casella della pagina ha un «Salva», e chiudere o cambiare scheda non avvisa la pagina (#590.5): ognuna
  // parte da qui, dopo una pausa o al primo segno di uscita. Uscendo, i numeri fuori scala tornano al valore in uso.
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      if (!caricato) return;
      canonAutoArchiveIdle();
      canonNotifDuration();
    },
    spegni(nome) {
      const hint = $({ token: 'tokenSavedHint', tabColor: 'tabColorSavedHint' }[nome] || 'savedHint');
      if (hint) hint.classList.remove('sn-show');
    },
  });
  caselle.registra('pref', () => persist());
  caselle.registra('token', () => persistTokens());
  caselle.registra('tabColor', () => persistTabColor());

  // L'indicatore «Salvato» lampeggia sull'ancora più vicina al controllo toccato.
  const _savedTimers = {};
  function flashSaved(id = 'savedHint') {
    const hint = $(id);
    if (!hint) return;
    hint.classList.add('sn-show');
    clearTimeout(_savedTimers[id]);
    _savedTimers[id] = setTimeout(() => hint.classList.remove('sn-show'), 1200);
  }

  // Gli override dei token estetici vivono in una mappa piatta (REPLACE in storage): un token
  // è «personalizzato» SOLO con un override diretto, non se eredita da una categoria.

  let currentOverrides = {};

  // I default di alcuni token cambiano fra chiaro e scuro: serve il tema risolto su <html>.
  function resolvedTheme() {
    return document.documentElement.dataset.snTheme === 'dark' ? 'dark' : 'light';
  }

  function isColorToken(name) {
    const t = Tokens && Tokens.get(name);
    return !!t && t.type === 'color';
  }

  function tokenErrorMsg(name) {
    return Tokens ? Tokens.errorMessage(name) : 'Valore non valido.';
  }

  function renderTokenRow(name) {
    const input = $(`tok-${name}`);
    if (!input || !Tokens) return;
    const row = input.closest('.sn-token-row');
    const eff = Tokens.effectiveValue(name, currentOverrides, resolvedTheme()) || '';
    input.value = eff;
    input.dataset.orig = eff;
    const modified = Tokens.validate(name, currentOverrides[name]);
    row.classList.toggle('sn-token-modified', !!modified);
    row.classList.remove('sn-token-invalid');
    if (isColorToken(name)) {
      const sw = row.querySelector('.sn-token-swatch');
      if (sw) sw.style.background = eff;
    }
    const err = row.querySelector('.sn-token-error');
    if (err) { err.hidden = true; err.textContent = ''; }
  }

  function buildTokenSection() {
    const box = $('tokenCode');
    if (!box || !Tokens) return;
    box.textContent = '';
    for (const name of Tokens.names()) {
      const t = Tokens.get(name);
      const row = document.createElement('div');
      row.className = 'sn-token-row';
      row.dataset.token = name;

      const swatch = document.createElement('span');
      swatch.className = 'sn-token-swatch';
      if (t.type !== 'color') swatch.style.visibility = 'hidden';
      row.appendChild(swatch);

      const label = document.createElement('label');
      label.className = 'sn-token-name';
      label.setAttribute('for', `tok-${name}`);
      label.title = t.label || name;
      label.textContent = `${name}:`;
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-token-input';
      input.id = `tok-${name}`;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', t.label || name);
      input.addEventListener('input', (e) => onTokenInput(name, e));
      input.addEventListener('blur', () => {
        const v = input.value.trim();
        if (v !== '' && !Tokens.validate(name, v)) {
          // Valore non valido: errore puntuale, gli altri token intatti, il testo resta
          // correggibile.
          const errEl = row.querySelector('.sn-token-error');
          errEl.hidden = false;
          errEl.textContent = tokenErrorMsg(name);
          row.classList.add('sn-token-invalid');
          return;
        }
        if (!tokenDaSalvare.has(name)) tokenInCorso.delete(name);
        renderTokenRow(name); // canonicalizza al valore effettivo
      });
      row.appendChild(input);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'sn-token-reset';
      reset.textContent = '↺';
      reset.title = 'Ripristina il predefinito';
      reset.setAttribute('aria-label', `Ripristina ${name}`);
      reset.addEventListener('click', () => resetToken(name));
      row.appendChild(reset);

      const err = document.createElement('span');
      err.className = 'sn-token-error';
      err.hidden = true;
      err.setAttribute('role', 'alert');
      row.appendChild(err);

      box.appendChild(row);
      renderTokenRow(name);
    }
  }

  function applyTokensLive() {
    Bootstrap.applyThemeTokens(currentOverrides);
  }

  // Si mandano solo i token toccati qui e il main li posa sulla mappa salvata: un colore chiesto a Filo con la pagina
  // aperta resta al primo ritocco (#592), e il salvataggio parte subito, prima che la scheda si chiuda (#1343.1).
  const tokenDaSalvare = new Set();
  const tokenInCorso = new Set();
  let tokenAzzeraTutti = false;
  // Un token spedito resta di questa pagina finché il main non risponde: l'eco di un cambio partito prima (il tema
  // toccato subito dopo, la chat) lo riporterebbe indietro nel campo.
  const tokenInViaggio = new Map();
  let giriToken = 0;

  async function persistTokens() {
    const biglietto = caselle.spedita('token');
    const tutti = tokenAzzeraTutti;
    const nomi = tutti && Tokens ? Tokens.names() : [...tokenDaSalvare];
    tokenDaSalvare.clear();
    tokenAzzeraTutti = false;
    if (!nomi.length) return;
    const giro = ++giriToken;
    const modifica = {};
    for (const name of nomi) {
      tokenInViaggio.set(name, giro);
      modifica[name] = Object.prototype.hasOwnProperty.call(currentOverrides, name) ? currentOverrides[name] : null;
      const input = $(`tok-${name}`);
      const v = input ? input.value.trim() : '';
      if (v === '' || !Tokens || Tokens.validate(name, v)) tokenInCorso.delete(name);
    }
    // «Ripristina tutti» sostituisce la mappa: se ne vanno anche i token che questa pagina non conosce.
    const msg = tutti
      ? { type: MSG.UPDATE_SETTINGS, settings: { themeTokens: {} } }
      : { type: MSG.UPDATE_SETTINGS, settings: { themeTokens: modifica }, tokenModifica: true };
    let r = null;
    try { r = await chrome.runtime.sendMessage(msg); } catch (_) {}
    for (const name of nomi) if (tokenInViaggio.get(name) === giro) tokenInViaggio.delete(name);
    if (r && r.ok && r.settings) riallineaToken(r.settings.themeTokens);
    if (caselle.aggiornata('token', biglietto)) flashSaved('tokenSavedHint');
  }

  // Un aggiornamento arrivato da altrove: si ridisegnano i token che l'utente
  // non sta scrivendo qui, gli altri restano come li ha lasciati.
  function riallineaToken(mappa) {
    if (!Tokens) return;
    const salvati = mappa || {};
    const nomi = new Set([...Object.keys(currentOverrides), ...Object.keys(salvati)]);
    const mio = (name) => tokenInCorso.has(name) || tokenDaSalvare.has(name) || tokenInViaggio.has(name);
    for (const name of nomi) {
      if (mio(name)) continue;
      if (Object.prototype.hasOwnProperty.call(salvati, name)) currentOverrides[name] = salvati[name];
      else delete currentOverrides[name];
    }
    for (const name of Tokens.names()) {
      if (!mio(name)) renderTokenRow(name);
    }
  }

  // Ridisegna tutte le righe TRANNE quella in `exceptName`, che l'utente sta editando: serve
  // quando cambia un token-categoria e chi eredita da lui deve mostrare subito il nuovo valore.
  function renderOtherTokenRows(exceptName) {
    if (!Tokens) return;
    for (const name of Tokens.names()) if (name !== exceptName && !tokenInCorso.has(name)) renderTokenRow(name);
  }

  function onTokenInput(name, e) {
    const input = $(`tok-${name}`);
    const row = input.closest('.sn-token-row');
    const err = row.querySelector('.sn-token-error');
    const v = input.value.trim();
    tokenInCorso.add(name);

    // L'errore compare al blur, non mentre si digita: altrimenti lampeggerebbe «non valido» a
    // ogni carattere di un colore scritto a mano. Finché non è valido non si applica nulla.
    err.hidden = true;
    err.textContent = '';
    row.classList.remove('sn-token-invalid');
    if (v !== '' && !Tokens.validate(name, v)) return;

    const canonico = v === '' ? '' : Tokens.normalize(name, v);
    if (canonico === '' || canonico === Tokens.defaultValue(name, resolvedTheme())) {
      // Vuoto o uguale al predefinito del tema corrente: nessun override.
      delete currentOverrides[name];
    } else {
      currentOverrides[name] = canonico;
    }
    row.classList.toggle('sn-token-modified', !!Tokens.validate(name, currentOverrides[name]));
    if (isColorToken(name)) {
      const sw = row.querySelector('.sn-token-swatch');
      if (sw) sw.style.background = Tokens.effectiveValue(name, currentOverrides, resolvedTheme()) || '';
    }
    tokenDaSalvare.add(name);
    renderOtherTokenRows(name);
    applyTokensLive();
    caselle.cambiato('token', e);
  }

  // Chi torna indietro dalla personalizzazione (#1471): cosa rimette di serie, per nome dell'elenco, mai il valore.
  function contaRipristino(campi) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CONTATORI_EVENTO, misura: 'gesto', gesto: 'ripristino', ...campi })).catch(() => {}); } catch (_) {}
  }

  function resetToken(name) {
    contaRipristino({ cosa: 'token', token: name });
    delete currentOverrides[name];
    tokenInCorso.delete(name);
    tokenDaSalvare.add(name);
    renderTokenRow(name);
    renderOtherTokenRows(name); // se era una categoria, aggiorna chi ereditava
    applyTokensLive();
    persistTokens();
  }

  function resetAllTokens() {
    contaRipristino({ cosa: 'tutti_token' });
    currentOverrides = {};
    tokenInCorso.clear();
    tokenAzzeraTutti = true;
    if (Tokens) for (const name of Tokens.names()) renderTokenRow(name);
    applyTokensLive();
    persistTokens();
  }

  // La sezione delle impostazioni avanzate arrivata sotto gli occhi, una volta per apertura della pagina (#1471).
  let avanzateGuardate = false;
  function guardaLeAvanzate() {
    const sezione = document.getElementById('sec-advanced');
    if (avanzateGuardate || !sezione || typeof IntersectionObserver !== 'function') return;
    avanzateGuardate = true;
    const io = new IntersectionObserver((voci) => {
      if (!voci.some((v) => v.isIntersecting)) return;
      io.disconnect();
      contaRipristino({ cosa: 'avanzate_viste' });
    });
    io.observe(sezione);
  }

  // Un solo bottone riporta TUTTE le impostazioni ai predefiniti: una personalizzazione
  // fatta a voce resta appiccicata e i reset parziali non bastano. Le chiavi API restano.
  async function resetAllSettings() {
    const Ui = window.SN_CONFIRM_UI;
    const text = 'Riporta TUTTE le impostazioni di Filo ai valori predefiniti: '
      + 'tema, colori e aspetto, colore delle schede, dimensione del testo, '
      + 'notifiche, gestione delle schede e ogni altra preferenza. '
      + 'Le tue chiavi API e l’autonomia di Filo restano come sono. Si rimette com’era con «annulla» sulla riga del cambio nella home, o chiedendolo a Filo.';
    const ok = Ui
      ? await Ui.confirm({ title: 'Ripristina tutte le impostazioni', text, okLabel: 'Ripristina tutto' })
      : window.confirm(`${text} Procedo?`);
    contaRipristino({ cosa: 'tutte_impostazioni', esito: ok ? 'confermato' : 'annullato' });
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: MSG.RESET_SETTINGS });
    // Ricarica la pagina: si ri-bootstrappa dai predefiniti, senza stato residuo.
    flashSaved('resetAllSavedHint');
    setTimeout(() => { try { location.reload(); } catch (_) {} }, 350);
  }

  // Rilancio dell'intervista (#524): azzera spunte e conversazione, ma non tocca memoria né
  // impostazioni già applicate — rifarla non è disfare quello che Filo ha imparato.
  async function restartOnboarding() {
    const r = await chrome.runtime.sendMessage({ type: MSG.FILO_RESTART_ONBOARDING });
    if (!r || !r.ok) return;
    flashSaved('onboardingHint');
    renderOnboardingArchive(r.onboarding);
    // Il segno lega l'intervista a questa scheda: le altre home restano il filo (#1297).
    chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://newtab/?accoglienza=1' });
  }

  function onboardingWhen(conv) {
    const iso = conv.startedAt || conv.closedAt;
    if (!iso) return 'Intervista di benvenuto';
    try {
      return new Date(iso).toLocaleString('it-IT', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return 'Intervista di benvenuto'; }
  }

  // «Conservata» senza un posto dove rileggerla non vuol dire niente: la prima intervista è
  // la prima cosa che l'utente ha raccontato di sé.
  function renderOnboardingArchive(state) {
    const box = $('onboardingArchive');
    if (!box) return;
    const O = window.SN_ONBOARDING;
    const list = O ? O.conversations(state) : [];
    box.innerHTML = '';
    box.hidden = list.length === 0;
    if (!list.length) return;
    list.forEach((conv, i) => {
      const det = document.createElement('details');
      det.className = 'onb-conv';
      const sum = document.createElement('summary');
      const when = document.createElement('span');
      when.className = 'onb-conv-when';
      when.textContent = onboardingWhen(conv);
      const meta = document.createElement('span');
      meta.className = 'onb-conv-turns';
      const scambi = conv.thread.filter((m) => m.role === 'user').length;
      meta.textContent = conv.current && !state.done
        ? 'in corso'
        : `${cifre(scambi)} ${scambi === 1 ? 'risposta tua' : 'tue risposte'}`;
      sum.appendChild(when);
      sum.appendChild(meta);
      // Quello che Filo conserva si toglie da qui, una per una (#1297); quella ancora aperta si chiude dalla home.
      if (!(conv.current && !state.done)) {
        const via = document.createElement('button');
        via.type = 'button';
        via.className = 'mem-via onb-via';
        via.textContent = '×';
        via.title = 'Togli';
        via.setAttribute('aria-label', `Togli l’intervista del ${onboardingWhen(conv)}`);
        via.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          togliIntervista(via, O.chiaveConversazione(conv));
        });
        sum.appendChild(via);
      }
      det.appendChild(sum);
      const lines = document.createElement('div');
      lines.className = 'onb-lines';
      for (const m of conv.thread) {
        const row = document.createElement('div');
        row.className = 'onb-line';
        const who = document.createElement('span');
        who.className = 'onb-who';
        who.textContent = m.role === 'filo' ? 'Filo' : 'Tu';
        const what = document.createElement('span');
        what.className = 'onb-what';
        what.textContent = m.text;
        row.appendChild(who);
        row.appendChild(what);
        lines.appendChild(row);
      }
      det.appendChild(lines);
      if (i === 0) det.open = true;
      box.appendChild(det);
    });
  }

  async function togliIntervista(btn, chiave) {
    btn.disabled = true;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.FILO_ONBOARDING_TOGLI, chiave }); } catch (_) { r = null; }
    if (r && r.ok && r.onboarding) renderOnboardingArchive(r.onboarding);
    else btn.disabled = false;
  }

  async function loadOnboardingArchive() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.FILO_GET_ONBOARDING, peek: true });
      if (r?.ok && r.onboarding) renderOnboardingArchive(r.onboarding);
    } catch (_) {}
  }

  // Colore identità delle tab: una riga per ognuno dei sei parametri di shared/tabColor.js,
  // clampata al range e applicata live; ↺ per uno, il bottone in fondo per tutti.
  let currentTabColor = {};

  function buildTabColorSection() {
    const box = $('tabColorCode');
    if (!box || !TabColor || !Array.isArray(TabColor.IDENTITY_PARAM_META)) return;
    box.textContent = '';
    for (const m of TabColor.IDENTITY_PARAM_META) {
      const row = document.createElement('div');
      row.className = 'sn-token-row';
      row.dataset.param = m.key;

      // Nessun campione colore qui: occupa lo spazio (allineamento con i token).
      const spacer = document.createElement('span');
      spacer.className = 'sn-token-swatch';
      spacer.style.visibility = 'hidden';
      row.appendChild(spacer);

      const label = document.createElement('label');
      label.className = 'sn-token-name';
      label.setAttribute('for', `tabcol-${m.key}`);
      label.title = m.comment || m.label;
      label.textContent = `${m.key}:`;
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'sn-token-input';
      input.id = `tabcol-${m.key}`;
      input.min = String(m.min);
      input.max = String(m.max);
      input.step = String(m.step);
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `${m.label} (${cifre(m.min)}–${cifre(m.max)})`);
      input.addEventListener('input', (e) => onTabColorInput(m.key, e));
      input.addEventListener('blur', () => {
        if (!tabColDaSalvare.has(m.key)) tabColInCorso.delete(m.key);
        renderTabColorRow(m.key);
      });
      row.appendChild(input);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'sn-token-reset';
      reset.textContent = '↺';
      reset.title = `Ripristina il predefinito (${cifre(m.def)})`;
      reset.setAttribute('aria-label', `Ripristina ${m.key}`);
      reset.addEventListener('click', () => resetTabColorParam(m.key));
      row.appendChild(reset);

      const help = document.createElement('span');
      help.className = 'sn-token-error';
      help.hidden = false;
      help.style.color = 'var(--sn-muted, #888)';
      help.style.gridColumn = '2 / -1';
      help.textContent = `intervallo ${cifre(m.min)}–${cifre(m.max)} · ${m.comment}`;
      row.appendChild(help);

      box.appendChild(row);
      renderTabColorRow(m.key);
    }
  }

  function tabColorMeta(key) {
    return (TabColor && TabColor.IDENTITY_PARAM_META || []).find((m) => m.key === key) || null;
  }

  function renderTabColorRow(key) {
    const input = $(`tabcol-${key}`);
    const m = tabColorMeta(key);
    if (!input || !m) return;
    const v = Number(currentTabColor[key]);
    const val = Number.isFinite(v) ? v : m.def;
    input.value = String(val);
    const row = input.closest('.sn-token-row');
    if (row) row.classList.toggle('sn-token-modified', val !== m.def);
  }

  // Come per i token: si mandano solo i parametri toccati qui, e quelli che
  // l'utente sta scrivendo non si riscrivono da sotto (#592).
  const tabColDaSalvare = new Set();
  const tabColInCorso = new Set();

  function onTabColorInput(key, e) {
    const input = $(`tabcol-${key}`);
    const m = tabColorMeta(key);
    if (!input || !m) return;
    tabColInCorso.add(key);
    let n = parseFloat(String(input.value).replace(',', '.'));
    if (!Number.isFinite(n)) return; // campo intermedio (vuoto/"-"): non salvare ora
    n = Math.max(m.min, Math.min(m.max, n));
    if (m.step >= 1) n = Math.round(n);
    currentTabColor[key] = n;
    tabColDaSalvare.add(key);
    const row = input.closest('.sn-token-row');
    if (row) row.classList.toggle('sn-token-modified', n !== m.def);
    caselle.cambiato('tabColor', e);
  }

  function resetTabColorParam(key) {
    const m = tabColorMeta(key);
    if (!m) return;
    contaRipristino({ cosa: 'colore_schede', parametro: key });
    currentTabColor[key] = m.def;
    tabColInCorso.delete(key);
    tabColDaSalvare.add(key);
    renderTabColorRow(key);
    persistTabColor();
  }

  function resetAllTabColor() {
    contaRipristino({ cosa: 'tutto_colore_schede' });
    currentTabColor = TabColor ? TabColor.defaultParams() : {};
    tabColInCorso.clear();
    if (TabColor && Array.isArray(TabColor.IDENTITY_PARAM_META)) {
      for (const m of TabColor.IDENTITY_PARAM_META) {
        tabColDaSalvare.add(m.key);
        renderTabColorRow(m.key);
      }
    }
    persistTabColor();
  }

  function persistTabColor() {
    caselle.spedita('tabColor');
    const clamped = TabColor ? TabColor.clampParams(currentTabColor) : currentTabColor;
    currentTabColor = clamped;
    const parte = {};
    for (const key of tabColDaSalvare) {
      if (Object.prototype.hasOwnProperty.call(clamped, key)) parte[key] = clamped[key];
      const n = parseFloat(String(($(`tabcol-${key}`) || {}).value || '').replace(',', '.'));
      if (Number.isFinite(n)) tabColInCorso.delete(key);
    }
    tabColDaSalvare.clear();
    if (!Object.keys(parte).length) return;
    chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { tabColor: parte },
    });
    flashSaved('tabColorSavedHint');
  }

  function riallineaTabColor(salvati) {
    if (!TabColor || !Array.isArray(TabColor.IDENTITY_PARAM_META)) return;
    const fresh = TabColor.clampParams(salvati || {});
    for (const m of TabColor.IDENTITY_PARAM_META) {
      if (tabColInCorso.has(m.key) || tabColDaSalvare.has(m.key)) continue;
      currentTabColor[m.key] = fresh[m.key];
      renderTabColorRow(m.key);
    }
  }

  // Lo stile come si salva e come arriva al modello: quello che si legge nel
  // riquadro (#592).
  function currentStyleText() {
    return testoLeggibile($('agentStyleText').value);
  }

  // Il conto compare solo vicino al tetto; oltre, il testo resta nel campo ma
  // non si salva finché non lo si accorcia. Torna se il testo è salvabile.
  function syncStyleNote() {
    const n = agentStyleLength(currentStyleText());
    const over = n > AGENT_STYLE_MAX;
    const note = $('agentStyleNote');
    note.hidden = !over && n < AGENT_STYLE_MAX * 0.8;
    note.classList.toggle('agent-style-over', over);
    $('agentStyleText').classList.toggle('agent-style-over', over);
    note.textContent = over
      ? `Troppo lungo: ${cifre(n)} caratteri, il massimo è ${cifre(AGENT_STYLE_MAX)}. Non lo salvo finché non lo accorci.`
      : `${cifre(n)} / ${cifre(AGENT_STYLE_MAX)}`;
    mostraTuttoLoStile();
    return !over;
  }

  // Lo stile entra in ogni conversazione: il riquadro cresce col testo, così
  // niente resta sotto il bordo, nemmeno dopo righe che a schermo sono bianche (#592).
  function mostraTuttoLoStile() {
    const el = $('agentStyleText');
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }

  function syncPresetSelect() {
    const text = currentStyleText().trim();
    const match = AGENT_STYLE_PRESETS.find((p) => p.text.trim() === text);
    $('agentStylePreset').value = match ? match.key : CUSTOM_KEY;
  }

  function ttsSupported() {
    return typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // getVoices() può tornare [] al primo giro e popolarsi dopo (voiceschanged): si richiama
  // anche da lì, mantenendo la scelta corrente se ancora disponibile.
  function populateVoices(selected) {
    const sel = $('ttsVoice');
    if (!sel || !ttsSupported()) return;
    const want = selected !== undefined ? selected : sel.value;
    const voices = window.speechSynthesis.getVoices() || [];
    sel.innerHTML = '<option value="">Voce predefinita del sistema</option>';
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.voiceURI || v.name;
      o.textContent = `${v.name} (${v.lang})${v.default ? ' — predefinita' : ''}`;
      sel.appendChild(o);
    }
    if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
  }

  // Le voci sono quelle del MODELLO di lettura in uso. «Altra voce» apre un campo libero, e
  // una voce salvata fuori elenco finisce lì invece di sparire.
  const CUSTOM_VOICE = '__custom__';
  function currentModelVoice() {
    const sel = $('ttsModelVoice');
    if (!sel) return '';
    if (sel.value === CUSTOM_VOICE) return ($('ttsModelVoiceCustom').value || '').trim();
    return sel.value || '';
  }
  function syncCustomVoiceField() {
    const sel = $('ttsModelVoice');
    const input = $('ttsModelVoiceCustom');
    if (!sel || !input) return;
    input.hidden = sel.value !== CUSTOM_VOICE;
  }
  async function populateModelVoices(selected) {
    const sel = $('ttsModelVoice');
    const input = $('ttsModelVoiceCustom');
    const where = $('ttsModelVoiceModel');
    if (!sel) return;
    const want = selected !== undefined ? selected : currentModelVoice();
    let info = null;
    try { info = await chrome.runtime.sendMessage({ type: MSG.TTS_VOICES }); } catch (_) { info = null; }
    const groups = (info && info.ok && Array.isArray(info.groups)) ? info.groups : [];
    const required = info && info.ok ? info.required !== false : true;
    sel.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = groups.length
      ? 'Automatica: segue la lingua del testo'
      : (required ? 'Automatica' : 'Automatica: la sceglie il modello');
    sel.appendChild(auto);
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label.charAt(0).toUpperCase() + g.label.slice(1);
      for (const v of g.voices) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = v.label;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    const custom = document.createElement('option');
    custom.value = CUSTOM_VOICE;
    custom.textContent = 'Altra voce: scrivi il nome…';
    sel.appendChild(custom);
    if (where) {
      const model = info && info.model ? info.model : '';
      where.textContent = model ? `Modello: ${model}` : (info && info.error ? 'Nessun modello di lettura impostato' : '');
      where.title = info && info.catalogName ? `Voci di ${info.catalogName}` : '';
    }
    const V = window.SN_TTS_VOICES;
    if (want && [...sel.options].some((o) => o.value === want && o.value !== CUSTOM_VOICE)) {
      sel.value = want;
      if (input) input.value = '';
    } else if (want && V && V.catalogOfVoice(want)) {
      // Voce di un ALTRO modello, rimasta da prima: la lettura la ignora e va con la lingua del
      // testo, quindi la pagina dice lo stesso (mostrarla come «altra voce» sarebbe una bugia).
      sel.value = '';
      if (input) input.value = '';
    } else if (want) {
      sel.value = CUSTOM_VOICE;
      if (input) input.value = want;
    } else {
      sel.value = '';
      if (input) input.value = '';
    }
    syncCustomVoiceField();
  }

  const MODEL_VOICE_SAMPLES = window.SN_TTS_VOICES.FRASI_DI_PROVA;

  // PCM 16 bit mono → WAV in un blob URL (stesso incapsulamento del content script).
  function pcmBase64ToWavUrl(base64, sampleRate) {
    const bin = atob(base64);
    const n = bin.length;
    const buffer = new ArrayBuffer(44 + n);
    const view = new DataView(buffer);
    let off = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
    const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
    const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
    writeStr('RIFF'); writeU32(36 + n); writeStr('WAVE');
    writeStr('fmt '); writeU32(16); writeU16(1); writeU16(1);
    writeU32(sampleRate); writeU32(sampleRate * 2); writeU16(2); writeU16(16);
    writeStr('data'); writeU32(n);
    for (let i = 0; i < n; i++) view.setUint8(off++, bin.charCodeAt(i) & 0xff);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  let modelPreviewAudio = null;
  async function previewModelVoice() {
    const btn = $('ttsModelPreview');
    const status = $('ttsModelPreviewStatus');
    const V = window.SN_TTS_VOICES;
    const voice = currentModelVoice();
    const lang = ((voice && V) ? V.langOfVoice(voice) : '') || (navigator.language || 'it').split('-')[0];
    const text = MODEL_VOICE_SAMPLES[lang] || MODEL_VOICE_SAMPLES.en;
    if (modelPreviewAudio) { try { modelPreviewAudio.pause(); } catch (_) {} modelPreviewAudio = null; }
    btn.disabled = true;
    status.textContent = '…';
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.TTS_SYNTH, text, lang, voice });
      if (!res || !res.ok) {
        status.textContent = (res && res.error) || 'Voce naturale non disponibile in questo momento';
        return;
      }
      const m = /rate=(\d+)/.exec(String(res.mimeType || ''));
      const url = pcmBase64ToWavUrl(res.audioBase64, m ? parseInt(m[1], 10) : 24000);
      const audio = new Audio(url);
      modelPreviewAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (modelPreviewAudio === audio) modelPreviewAudio = null; };
      await audio.play();
      status.textContent = '';
    } catch (e) {
      status.textContent = (e && e.message) || 'Errore';
    } finally {
      btn.disabled = false;
    }
  }

  function previewTts() {
    if (!ttsSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(window.SN_TTS_VOICES.FRASE_DI_PROVA_SISTEMA);
    u.rate = parseFloat($('ttsRate').value) || 1;
    u.pitch = parseFloat($('ttsPitch').value) || 1;
    const voiceId = $('ttsVoice').value;
    if (voiceId) {
      const v = (synth.getVoices() || []).find((vo) => vo.voiceURI === voiceId || vo.name === voiceId);
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    synth.speak(u);
  }

  // I motivi stanno in SN_SOUNDS e basta: l'anteprima qui, le notifiche della
  // shell e la suoneria di timer e sveglie devono suonare gli stessi.
  const Sounds = window.SN_SOUNDS;

  // Stesse voci della suoneria: i due elenchi non devono divergere.
  function populateNotifSounds() {
    const sel = $('notifSound');
    if (!sel || sel.options.length) return;
    const labels = (Sounds && Sounds.TONE_LABELS) || { default: 'Standard' };
    const ids = (Sounds && Sounds.TONE_IDS) || ['default'];
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = labels[id] || id;
      sel.appendChild(o);
    }
  }

  // Il volume si giudica a orecchio: l'anteprima usa quello scelto adesso, o
  // la manopola si regolerebbe alla cieca.
  function volumeDa(id) {
    const n = parseInt($(id).value, 10);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
  }
  function previewRingtone() {
    if (Sounds) Sounds.play($('timerRingtone').value, volumeDa('timerRingtoneVolume'));
  }
  function previewNotifSound() {
    if (Sounds) Sounds.play($('notifSound').value, volumeDa('notifSoundVolume'));
  }
  function mostraVolume(id) {
    const eco = $(id + 'Val');
    if (eco) eco.textContent = `${volumeDa(id)}%`;
  }
  // Un valore assente o storto vale «pieno»: il silenzio si sceglie.
  function volumeSalvato(salvato) {
    const n = Number(salvato);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
  }
  function caricaVolume(id, salvato) {
    $(id).value = String(volumeSalvato(salvato));
    mostraVolume(id);
  }

  // Clamp dei due campi numerici liberi, usato sia dal salvataggio sia dal riallineamento al
  // blur, così ciò che si vede è sempre ciò che è salvato. idleHours: 1..168 (default 6).
  function clampIdleHours(raw) {
    return Number.isFinite(raw) && raw > 0 ? Math.min(168, raw) : 6;
  }
  // durata notifica 0..120 s (0 = resta finché non la chiudi; vuoto o negativo → 5).
  function clampNotifDurationSec(raw) {
    return Number.isFinite(raw) && raw >= 0 ? Math.min(120, raw) : 5;
  }

  // Riallinea il campo al valore realmente salvato e clampato: appena si lascia il campo
  // sparisce il numero fuori scala digitato e compare quello in uso.
  function canonAutoArchiveIdle() {
    const input = $('autoArchiveIdleHours');
    if (!input) return;
    input.value = String(clampIdleHours(parseInt(input.value, 10)));
  }
  function canonNotifDuration() {
    const input = $('notifDuration');
    if (!input) return;
    input.value = String(clampNotifDurationSec(parseInt(input.value, 10)));
  }

  // Campi toccati qui e non ancora partiti: persist() manda solo questi, e un
  // cambio arrivato da altrove (la chat, un'altra scheda) non li riscrive. Il
  // resto della pagina segue la memoria (#592).
  const toccati = new Set();
  // Quale campo scrive quale impostazione: lo dice la fonte unica delle voci, la stessa da cui la chat
  // legge e cambia ogni preferenza (#949).
  const CAMPO_DI = window.SN_VOCI_IMPOSTAZIONI.campi('preferences');

  function valoreDelCampo(k) {
    switch (k) {
      case 'theme': return $('theme').value;
      case 'textScale': return parseFloat($('textScale').value) || 1;
      case 'showHomeMessage': return $('showHomeMessage').checked;
      case 'homeSistema.ora': return $('homeSisOra').checked;
      case 'homeSistema.batteria': return $('homeSisBatteria').checked;
      case 'homeSistema.rete': return $('homeSisRete').checked;
      case 'homeSistema.bluetooth': return $('homeSisBluetooth').checked;
      case 'homeSistema.volume': return $('homeSisVolume').checked;
      case 'tabPreview.enabled': return $('tabPreviewEnabled').checked;
      case 'tabPreview.size': return misuraAnteprima($('tabPreviewSize').value);
      case 'agentStyle': return currentStyleText();
      case 'timerRingtone': return $('timerRingtone').value || 'default';
      case 'timerRingtoneVolume': return volumeDa('timerRingtoneVolume');
      case 'terminal.enabled': return $('terminalEnabled').checked;
      case 'schermo.guarda': return $('schermoGuarda').checked;
      case 'nomiSensati.scaricamenti': return $('nomiSensatiScaricamenti').checked;
      case 'aggiornamenti.automatici': return $('aggiornamentiAutomatici').checked;
      case 'propostaEmail.attiva': return $('propostaEmailAttiva').checked;
      case 'propostaEmail.incognito': return $('propostaEmailIncognito').checked;
      case 'terminal.shell': return $('terminalShell').value;
      case 'aggiornamenti.installa': return $('aggiornamentiInstalla').value === 'chiusura' ? 'chiusura' : 'avvio';
      case 'tts.voice': return $('ttsVoice').value || '';
      case 'tts.rate': return parseFloat($('ttsRate').value) || 1;
      case 'tts.pitch': return parseFloat($('ttsPitch').value) || 1;
      case 'tts.modelVoice': return currentModelVoice();
      case 'autoArchive.enabled': return $('autoArchiveEnabled').checked;
      case 'autoArchive.idleHours': return clampIdleHours(parseInt($('autoArchiveIdleHours').value, 10));
      case 'autoArchive.onClose': return $('autoArchiveOnClose').checked;
      case 'riassuntoSchede.enabled': return $('riassuntoSchede').checked;
      case 'notifications.durationSec': return clampNotifDurationSec(parseInt($('notifDuration').value, 10));
      case 'notifications.soundEnabled': return $('notifSoundEnabled').checked;
      case 'notifications.sound': return $('notifSound').value || 'default';
      case 'barraLaterale.spinta': return $('barraSpinta').checked;
      case 'barraLaterale.striscia': return $('barraStriscia').checked;
      case 'barraLaterale.schede': return $('barraSchede').checked;
      case 'barraLaterale.attesaMs': return opzioniBarraLaterale({ attesaMs: $('barraAttesa').value }).attesaMs;
      case 'barraLaterale.uscitaMs': return opzioniBarraLaterale({ uscitaMs: $('barraUscita').value }).uscitaMs;
      case 'pannelloDestro.spinta': return $('pannelloSpinta').checked;
      case 'pannelloDestro.striscia': return $('pannelloStriscia').checked;
      case 'pannelloDestro.bloccato': return $('pannelloBloccato').checked;
      case 'pannelloDestro.attesaMs': return opzioniPannelloDestro({ attesaMs: $('pannelloAttesa').value }).attesaMs;
      case 'pannelloDestro.uscitaMs': return opzioniPannelloDestro({ uscitaMs: $('pannelloUscita').value }).uscitaMs;
      case 'avvisoSchermoPieno.durataMs': return opzioniAvvisoSchermoPieno({ durataMs: $('avvisoSchermoPienoDurata').value }).durataMs;
      case 'notifications.soundVolume': return volumeDa('notifSoundVolume');
      case 'dictation.autoSend': return $('dictationAutoSend').value !== 'no';
      case 'dictation.silenceSec': return dictationTimes({ silenceSec: $('dictationSilence').value }).silenceSec;
      case 'dictation.cancelSec': return dictationTimes({ cancelSec: $('dictationCancel').value }).cancelSec;
      case 'contestoFilo.giorni': return tettoContesto('giorni', $('contestoGiorni').value);
      case 'contestoFilo.token': return tettoContesto('token', $('contestoToken').value);
      case 'contestoFilo.cache': return window.SN_FILO_CONTESTO.durataIn($('contestoCache').value);
      case 'lunghezzaRisposte.conversazioni': return tettoRisposte($('lunghezzaConversazioni').value);
      case 'lunghezzaRisposte.testi': return tettoRisposte($('lunghezzaTesti').value);
      case 'lunghezzaRisposte.brevi': return tettoRisposte($('lunghezzaBrevi').value);
      case 'avvisoCrediti.attivo': return $('avvisoCreditiAttivo').checked;
      case 'avvisoCrediti.giorni': return sogliaCrediti('giorni', $('avvisoCreditiGiorni').value);
      case 'avvisoCrediti.percento': return sogliaCrediti('percento', $('avvisoCreditiPercento').value);
      case 'spiegaAnticipata.enabled': return $('spiegaAnticipata').checked;
      case 'descriviImmagini.enabled': return $('descriviImmagini').checked;
      case 'contatori.attivi': return $('contatoriAttivi').checked;
      case 'featureFlags.help': return $('aiutoAcceso').checked;
      case 'featureFlags.spellcheck': return $('correttoreAcceso').checked;
      case 'featureFlags.spellcheckContext': return $('correttoreSuggerimenti').checked;
      case 'featureFlags.categorize': return $('categorieAutomatiche').checked;
      case 'correttore.modelloErrori': return $('correttoreModello').checked;
      case 'correttore.ripetizioni': return $('correttoreRipetizioni').checked;
      case 'correttore.segnaposti': return $('correttoreSegnaposti').checked;
      case 'correttore.segnapostiWeb': return $('correttoreSegnapostiWeb').checked;
      case 'correttore.pausaRapidoMs': return tempoCorrettoreDelCampo('pausaRapidoMs');
      case 'correttore.ogniRapidoMs': return tempoCorrettoreDelCampo('ogniRapidoMs');
      case 'correttore.pausaRagionatoMs': return tempoCorrettoreDelCampo('pausaRagionatoMs');
      case 'correttore.automatica': return $('correttoreAutomatica').checked;
      case 'correttore.accettiPerImparare': return sogliaCorrettoreDelCampo('accettiPerImparare');
      case 'correttore.annulliPerImparare': return sogliaCorrettoreDelCampo('annulliPerImparare');
      case 'correttore.riscrittePerImparare': return sogliaCorrettoreDelCampo('riscrittePerImparare');
      default: return undefined;
    }
  }

  // Gli interruttori di funzione con il loro valore di serie: acceso finché non è `false`, o spento finché non è `true`.
  const INTERRUTTORI = [['help', 'aiutoAcceso', true], ['spellcheck', 'correttoreAcceso', true], ['spellcheckContext', 'correttoreSuggerimenti', true], ['categorize', 'categorieAutomatiche', false]];
  // I tempi del correttore (#1446): campo per chiave; limiti e predefiniti in SN_CONST.CORRETTORE_TEMPI.
  const CAMPI_TEMPI_CORRETTORE = { pausaRapidoMs: 'correttorePausaRapido', ogniRapidoMs: 'correttoreOgniRapido', pausaRagionatoMs: 'correttorePausaRagionato' };
  const tempoCorrettoreDelCampo = (campo) => tempiCorrettore({ correttore: { [campo]: $(CAMPI_TEMPI_CORRETTORE[campo]).value } })[campo];
  // Quante volte serve per imparare (#1447): limiti e predefiniti in SN_CONST.CORRETTORE_SOGLIE.
  const CAMPI_SOGLIE_CORRETTORE = { accettiPerImparare: 'correttoreAccetti', annulliPerImparare: 'correttoreAnnulli', riscrittePerImparare: 'correttoreRiscritte' };
  const sogliaCorrettoreDelCampo = (campo) => soglieCorrettore({ correttore: { [campo]: $(CAMPI_SOGLIE_CORRETTORE[campo]).value } })[campo];
  const interruttore = (s, nome, diSerie) => {
    const v = s.featureFlags && s.featureFlags[nome];
    return diSerie ? v !== false : v === true;
  };

  // Lo stesso valore letto dalla memoria, con le stesse regole di riempi().
  function valoreSalvato(s, k) {
    const aa = s.autoArchive || {};
    const tts = s.tts || {};
    const notif = s.notifications || {};
    const dur = Number(notif.durationSec);
    switch (k) {
      case 'theme': return s.theme || 'system';
      case 'textScale': return Number(s.textScale ?? 1);
      case 'showHomeMessage': return s.showHomeMessage !== false;
      case 'homeSistema.ora': return !(s.homeSistema && s.homeSistema.ora === false);
      case 'homeSistema.batteria': return !(s.homeSistema && s.homeSistema.batteria === false);
      case 'homeSistema.rete': return !(s.homeSistema && s.homeSistema.rete === false);
      case 'homeSistema.bluetooth': return !(s.homeSistema && s.homeSistema.bluetooth === false);
      case 'homeSistema.volume': return !(s.homeSistema && s.homeSistema.volume === false);
      case 'tabPreview.enabled': return !(s.tabPreview && s.tabPreview.enabled === false);
      case 'tabPreview.size': return misuraAnteprima(s.tabPreview && s.tabPreview.size);
      case 'agentStyle': return String(s.agentStyle || '').trim();
      case 'timerRingtone': return s.timerRingtone || 'default';
      case 'timerRingtoneVolume': return volumeSalvato(s.timerRingtoneVolume);
      case 'terminal.enabled': return !!(s.terminal && s.terminal.enabled === true);
      case 'schermo.guarda': return !!(s.schermo && s.schermo.guarda === true);
      case 'nomiSensati.scaricamenti': return !!(s.nomiSensati && s.nomiSensati.scaricamenti === true);
      case 'aggiornamenti.automatici': return !(s.aggiornamenti && s.aggiornamenti.automatici === false);
      case 'propostaEmail.attiva': return !(s.propostaEmail && s.propostaEmail.attiva === false);
      case 'propostaEmail.incognito': return !!(s.propostaEmail && s.propostaEmail.incognito === true);
      case 'aggiornamenti.installa': return s.aggiornamenti && s.aggiornamenti.installa === 'chiusura' ? 'chiusura' : 'avvio';
      case 'terminal.shell': return (s.terminal && s.terminal.shell) || '';
      case 'tts.voice': return tts.voice || '';
      case 'tts.rate': return Number(tts.rate) || 1;
      case 'tts.pitch': return Number(tts.pitch) || 1;
      case 'tts.modelVoice': return tts.modelVoice || '';
      case 'autoArchive.enabled': return aa.enabled !== false;
      case 'autoArchive.idleHours': return clampIdleHours(Number(aa.idleHours) > 0 ? Number(aa.idleHours) : 6);
      case 'autoArchive.onClose': return aa.onClose !== false;
      case 'riassuntoSchede.enabled': return !(s.riassuntoSchede && s.riassuntoSchede.enabled === false);
      case 'notifications.durationSec': return clampNotifDurationSec(Number.isFinite(dur) && dur >= 0 ? dur : 5);
      case 'notifications.soundEnabled': return notif.soundEnabled === true;
      case 'notifications.sound': return notif.sound || 'default';
      case 'barraLaterale.spinta': return opzioniBarraLaterale(s.barraLaterale).spinta;
      case 'barraLaterale.striscia': return opzioniBarraLaterale(s.barraLaterale).striscia;
      case 'barraLaterale.schede': return opzioniBarraLaterale(s.barraLaterale).schede;
      case 'barraLaterale.attesaMs': return opzioniBarraLaterale(s.barraLaterale).attesaMs;
      case 'barraLaterale.uscitaMs': return opzioniBarraLaterale(s.barraLaterale).uscitaMs;
      case 'pannelloDestro.spinta': return opzioniPannelloDestro(s.pannelloDestro).spinta;
      case 'pannelloDestro.striscia': return opzioniPannelloDestro(s.pannelloDestro).striscia;
      case 'pannelloDestro.bloccato': return opzioniPannelloDestro(s.pannelloDestro).bloccato;
      case 'pannelloDestro.attesaMs': return opzioniPannelloDestro(s.pannelloDestro).attesaMs;
      case 'pannelloDestro.uscitaMs': return opzioniPannelloDestro(s.pannelloDestro).uscitaMs;
      case 'avvisoSchermoPieno.durataMs': return opzioniAvvisoSchermoPieno(s.avvisoSchermoPieno).durataMs;
      case 'notifications.soundVolume': return volumeSalvato(notif.soundVolume);
      case 'dictation.autoSend': return !(s.dictation && s.dictation.autoSend === false);
      case 'dictation.silenceSec': return dictationTimes(s.dictation).silenceSec;
      case 'dictation.cancelSec': return dictationTimes(s.dictation).cancelSec;
      case 'contestoFilo.giorni': return tettoContesto('giorni', s.contestoFilo && s.contestoFilo.giorni);
      case 'contestoFilo.token': return tettoContesto('token', s.contestoFilo && s.contestoFilo.token);
      case 'contestoFilo.cache': return window.SN_FILO_CONTESTO.durataIn(s.contestoFilo && s.contestoFilo.cache);
      case 'lunghezzaRisposte.conversazioni':
      case 'lunghezzaRisposte.testi':
      case 'lunghezzaRisposte.brevi': return tettoRisposte(s.lunghezzaRisposte && s.lunghezzaRisposte[k.split('.')[1]]);
      case 'avvisoCrediti.attivo': return !(s.avvisoCrediti && s.avvisoCrediti.attivo === false);
      case 'avvisoCrediti.giorni': return sogliaCrediti('giorni', s.avvisoCrediti && s.avvisoCrediti.giorni);
      case 'avvisoCrediti.percento': return sogliaCrediti('percento', s.avvisoCrediti && s.avvisoCrediti.percento);
      case 'spiegaAnticipata.enabled': return !(s.spiegaAnticipata && s.spiegaAnticipata.enabled === false);
      case 'descriviImmagini.enabled': return !(s.descriviImmagini && s.descriviImmagini.enabled === false);
      case 'contatori.attivi': return !(s.contatori && s.contatori.attivi === false);
      case 'correttore.modelloErrori': return !(s.correttore && s.correttore.modelloErrori === false);
      case 'correttore.ripetizioni': return !(s.correttore && s.correttore.ripetizioni === false);
      case 'correttore.segnaposti': return !(s.correttore && s.correttore.segnaposti === false);
      case 'correttore.segnapostiWeb': return !(s.correttore && s.correttore.segnapostiWeb === false);
      case 'correttore.pausaRapidoMs':
      case 'correttore.ogniRapidoMs':
      case 'correttore.pausaRagionatoMs': return tempiCorrettore(s)[k.split('.')[1]];
      case 'correttore.automatica': return !(s.correttore && s.correttore.automatica === false);
      case 'correttore.accettiPerImparare':
      case 'correttore.annulliPerImparare':
      case 'correttore.riscrittePerImparare': return soglieCorrettore(s)[k.split('.')[1]];
      case 'featureFlags.help':
      case 'featureFlags.spellcheck':
      case 'featureFlags.spellcheckContext':
      case 'featureFlags.categorize': {
        const [nome, , diSerie] = INTERRUTTORI.find(([n]) => k === `featureFlags.${n}`);
        return interruttore(s, nome, diSerie);
      }
      default: return undefined;
    }
  }

  // Le soglie dell'avviso dei crediti (#818): vuoto = il predefinito, fuori scala torna dentro come nella chat.
  const sogliaCrediti = (k, v) => window.SN_CREDITI_AVVISO.numeroSoglia(k, v);
  const CAMPI_CREDITI = [['giorni', 'avvisoCreditiGiorni'], ['percento', 'avvisoCreditiPercento']];
  function canonCrediti() {
    for (const [k, id] of CAMPI_CREDITI) $(id).value = String(sogliaCrediti(k, $(id).value));
  }

  // Quanto ricorda la chat (#868): vuoto = come i predefiniti; fuori scala si riporta dentro come fa il main.
  function tettoContesto(k, v) {
    const FC = window.SN_FILO_CONTESTO;
    const c = FC.numeroIn(v, FC.LIMITI[k]);
    return c != null && k === 'token' ? Math.round(c) : c;
  }
  function canonContesto() {
    for (const [k, id] of [['giorni', 'contestoGiorni'], ['token', 'contestoToken']]) {
      const v = tettoContesto(k, $(id).value);
      $(id).value = v == null ? '' : String(v);
    }
  }
  // Quanto può essere lunga una risposta (#1097.3): vuoto = come i predefiniti; fuori scala torna dentro come nel main.
  const CAMPI_LUNGHEZZA = [['conversazioni', 'lunghezzaConversazioni'], ['testi', 'lunghezzaTesti'], ['brevi', 'lunghezzaBrevi']];
  const tettoRisposte = (v) => window.SN_LUNGHEZZA_RISPOSTE.numeroIn(v);
  function canonLunghezza() {
    for (const [, id] of CAMPI_LUNGHEZZA) {
      const v = tettoRisposte($(id).value);
      $(id).value = v == null ? '' : String(v);
    }
  }

  // I segnaposto dicono il valore che vale quando il campo è vuoto: quello dei Modelli predefiniti, o del codice.
  async function segnapostiContesto() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.DEFAULT_MODELS_PUBLIC });
      const d = { ...((r && r.contestoFiloDiSerie) || {}), ...((r && r.contestoFilo) || {}) };
      if (d.giorni != null) $('contestoGiorni').placeholder = String(d.giorni);
      if (d.token != null) $('contestoToken').placeholder = String(d.token);
      if (d.cache) $('contestoCachePredefinita').textContent = `Come i predefiniti (${d.cache === '1h' ? 'un\'ora' : '5 minuti'})`;
      const l = { ...((r && r.lunghezzaRisposteDiSerie) || {}), ...((r && r.lunghezzaRisposte) || {}) };
      for (const [f, id] of CAMPI_LUNGHEZZA) if (l[f] != null) $(id).placeholder = String(l[f]);
    } catch (_) {}
  }

  function scriviTempiVoce() {
    const sec = (n) => `${String(n).replace('.', ',')} s`;
    $('dictationSilenceVal').textContent = sec(parseFloat($('dictationSilence').value) || 0);
    $('dictationCancelVal').textContent = sec(parseFloat($('dictationCancel').value) || 0);
  }

  function misuraAnteprima(v) {
    return ['piccola', 'media', 'grande'].includes(v) ? v : 'media';
  }

  async function persist() {
    const biglietto = caselle.spedita('pref');
    const styleOk = syncStyleNote();
    const settings = {};
    const partiti = [];
    for (const k of toccati) {
      // Oltre il tetto lo stile resta nel campo e in sospeso: non parte.
      if (k === 'agentStyle' && !styleOk) continue;
      const [a, b] = k.split('.');
      if (b) settings[a] = { ...(settings[a] || {}), [b]: valoreDelCampo(k) };
      else settings[a] = valoreDelCampo(k);
      partiti.push(k);
    }
    for (const k of partiti) toccati.delete(k);

    const theme = $('theme').value;
    window.SN_PAGE_THEME = theme;
    Bootstrap.applyTheme(theme);
    Bootstrap.applyTextScale(parseFloat($('textScale').value) || 1);
    if (!partiti.length) return;
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings });
    // Una modifica arrivata mentre questa viaggiava: «Salvato» lo dice il salvataggio che la porta.
    if (caselle.aggiornata('pref', biglietto)) flashSaved();
  }

  function buildPresetOptions() {
    const sel = $('agentStylePreset');
    sel.innerHTML = '';
    for (const p of AGENT_STYLE_PRESETS) {
      const o = document.createElement('option');
      o.value = p.key;
      o.textContent = p.label;
      sel.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = CUSTOM_KEY;
    custom.textContent = 'Personalizzato';
    sel.appendChild(custom);
  }

  // Scrive nei campi i valori di `settings`; `vuole(k)` dice quali campi
  // toccare (al caricamento tutti, a un cambio arrivato da altrove solo quelli
  // che l'utente non sta cambiando qui).
  function riempi(settings, vuole = () => true) {
    if (vuole('theme')) $('theme').value = settings.theme || 'system';
    if (vuole('textScale')) {
      const scale = String(settings.textScale ?? 1);
      const opt = [...$('textScale').options].find((o) => o.value === scale);
      $('textScale').value = opt ? scale : '1';
    }
    if (vuole('showHomeMessage')) $('showHomeMessage').checked = settings.showHomeMessage !== false;
    const sis = settings.homeSistema || {};
    if (vuole('homeSistema.ora')) $('homeSisOra').checked = sis.ora !== false;
    if (vuole('homeSistema.batteria')) $('homeSisBatteria').checked = sis.batteria !== false;
    if (vuole('homeSistema.rete')) $('homeSisRete').checked = sis.rete !== false;
    if (vuole('homeSistema.bluetooth')) $('homeSisBluetooth').checked = sis.bluetooth !== false;
    if (vuole('homeSistema.volume')) $('homeSisVolume').checked = sis.volume !== false;
    const tp = settings.tabPreview || {};
    if (vuole('tabPreview.enabled')) $('tabPreviewEnabled').checked = tp.enabled !== false;
    if (vuole('tabPreview.size')) $('tabPreviewSize').value = misuraAnteprima(tp.size);
    $('tabPreviewSize').disabled = !$('tabPreviewEnabled').checked;

    if (vuole('agentStyle')) {
      $('agentStyleText').value = settings.agentStyle || '';
      syncPresetSelect();
      syncStyleNote();
    }

    const aa = settings.autoArchive || {};
    if (vuole('autoArchive.enabled')) $('autoArchiveEnabled').checked = aa.enabled !== false;
    if (vuole('autoArchive.onClose')) $('autoArchiveOnClose').checked = aa.onClose !== false;
    if (vuole('autoArchive.idleHours')) $('autoArchiveIdleHours').value = String(Number(aa.idleHours) > 0 ? Number(aa.idleHours) : 6);
    if (vuole('riassuntoSchede.enabled')) $('riassuntoSchede').checked = !(settings.riassuntoSchede && settings.riassuntoSchede.enabled === false);

    const barra = opzioniBarraLaterale(settings.barraLaterale);
    if (vuole('barraLaterale.spinta')) $('barraSpinta').checked = barra.spinta;
    if (vuole('barraLaterale.striscia')) $('barraStriscia').checked = barra.striscia;
    if (vuole('barraLaterale.schede')) $('barraSchede').checked = barra.schede;
    if (vuole('barraLaterale.attesaMs')) $('barraAttesa').value = String(barra.attesaMs);
    if (vuole('barraLaterale.uscitaMs')) $('barraUscita').value = String(barra.uscitaMs);
    const pannello = opzioniPannelloDestro(settings.pannelloDestro);
    if (vuole('pannelloDestro.spinta')) $('pannelloSpinta').checked = pannello.spinta;
    if (vuole('pannelloDestro.striscia')) $('pannelloStriscia').checked = pannello.striscia;
    if (vuole('pannelloDestro.bloccato')) $('pannelloBloccato').checked = pannello.bloccato;
    if (vuole('pannelloDestro.attesaMs')) $('pannelloAttesa').value = String(pannello.attesaMs);
    if (vuole('pannelloDestro.uscitaMs')) $('pannelloUscita').value = String(pannello.uscitaMs);
    if (vuole('avvisoSchermoPieno.durataMs')) $('avvisoSchermoPienoDurata').value = String(opzioniAvvisoSchermoPieno(settings.avvisoSchermoPieno).durataMs);

    const terminal = settings.terminal || {};
    if (vuole('terminal.enabled')) $('terminalEnabled').checked = terminal.enabled === true;
    if (vuole('schermo.guarda')) $('schermoGuarda').checked = !!(settings.schermo && settings.schermo.guarda === true);
    if (vuole('nomiSensati.scaricamenti')) $('nomiSensatiScaricamenti').checked = !!(settings.nomiSensati && settings.nomiSensati.scaricamenti === true);
    if (vuole('aggiornamenti.automatici')) $('aggiornamentiAutomatici').checked = !(settings.aggiornamenti && settings.aggiornamenti.automatici === false);
    if (vuole('propostaEmail.attiva')) $('propostaEmailAttiva').checked = !(settings.propostaEmail && settings.propostaEmail.attiva === false);
    if (vuole('propostaEmail.incognito')) $('propostaEmailIncognito').checked = !!(settings.propostaEmail && settings.propostaEmail.incognito === true);
    $('propostaEmailIncognito').disabled = !$('propostaEmailAttiva').checked;
    if (vuole('aggiornamenti.installa')) {
      $('aggiornamentiInstalla').value = settings.aggiornamenti && settings.aggiornamenti.installa === 'chiusura' ? 'chiusura' : 'avvio';
    }
    if (vuole('terminal.shell')) {
      const sel = $('terminalShell');
      const suWindows = shellDiWindows();
      const salvata = terminal.shell || (suWindows ? 'powershell' : 'sh');
      const predefinita = suWindows ? 'powershell' : 'sh';
      const shellOpt = [...sel.options].find((o) => o.value === salvata);
      sel.value = shellOpt ? salvata : predefinita;
    }

    const notif = settings.notifications || {};
    if (vuole('notifications.durationSec')) {
      const dur = Number(notif.durationSec);
      $('notifDuration').value = String(Number.isFinite(dur) && dur >= 0 ? dur : 5);
    }
    if (vuole('notifications.soundEnabled')) $('notifSoundEnabled').checked = notif.soundEnabled === true;
    if (vuole('notifications.sound')) {
      const notifSound = notif.sound || 'default';
      const nsOpt = [...$('notifSound').options].find((o) => o.value === notifSound);
      $('notifSound').value = nsOpt ? notifSound : 'default';
    }
    if (vuole('notifications.soundVolume')) caricaVolume('notifSoundVolume', notif.soundVolume);

    if (vuole('dictation.autoSend')) {
      $('dictationAutoSend').value = settings.dictation && settings.dictation.autoSend === false ? 'no' : 'si';
    }
    const tempiVoce = dictationTimes(settings.dictation);
    if (vuole('dictation.silenceSec')) $('dictationSilence').value = String(tempiVoce.silenceSec);
    if (vuole('dictation.cancelSec')) $('dictationCancel').value = String(tempiVoce.cancelSec);
    scriviTempiVoce();

    const cf = settings.contestoFilo || {};
    if (vuole('contestoFilo.giorni')) $('contestoGiorni').value = cf.giorni == null ? '' : String(cf.giorni);
    if (vuole('contestoFilo.token')) $('contestoToken').value = cf.token == null ? '' : String(cf.token);
    if (vuole('contestoFilo.cache')) $('contestoCache').value = window.SN_FILO_CONTESTO.durataIn(cf.cache) || '';
    const lr = settings.lunghezzaRisposte || {};
    for (const [f, id] of CAMPI_LUNGHEZZA) {
      if (vuole(`lunghezzaRisposte.${f}`)) $(id).value = lr[f] == null ? '' : String(lr[f]);
    }
    const ac = settings.avvisoCrediti || {};
    if (vuole('avvisoCrediti.attivo')) $('avvisoCreditiAttivo').checked = ac.attivo !== false;
    for (const [k, id] of CAMPI_CREDITI) {
      if (vuole(`avvisoCrediti.${k}`)) $(id).value = String(sogliaCrediti(k, ac[k]));
    }
    if (vuole('spiegaAnticipata.enabled')) $('spiegaAnticipata').checked = !(settings.spiegaAnticipata && settings.spiegaAnticipata.enabled === false);
    if (vuole('descriviImmagini.enabled')) $('descriviImmagini').checked = !(settings.descriviImmagini && settings.descriviImmagini.enabled === false);
    if (vuole('contatori.attivi')) $('contatoriAttivi').checked = !(settings.contatori && settings.contatori.attivi === false);
    for (const [nome, id, diSerie] of INTERRUTTORI) {
      if (vuole(`featureFlags.${nome}`)) $(id).checked = interruttore(settings, nome, diSerie);
    }
    const corr = settings.correttore || {};
    if (vuole('correttore.modelloErrori')) $('correttoreModello').checked = corr.modelloErrori !== false;
    if (vuole('correttore.ripetizioni')) $('correttoreRipetizioni').checked = corr.ripetizioni !== false;
    if (vuole('correttore.segnaposti')) $('correttoreSegnaposti').checked = corr.segnaposti !== false;
    if (vuole('correttore.segnapostiWeb')) $('correttoreSegnapostiWeb').checked = corr.segnapostiWeb !== false;
    const tempiCorr = tempiCorrettore(settings);
    for (const [campo, id] of Object.entries(CAMPI_TEMPI_CORRETTORE)) {
      if (vuole(`correttore.${campo}`)) $(id).value = String(tempiCorr[campo]);
    }
    if (vuole('correttore.automatica')) $('correttoreAutomatica').checked = corr.automatica !== false;
    const soglieCorr = soglieCorrettore(settings);
    for (const [campo, id] of Object.entries(CAMPI_SOGLIE_CORRETTORE)) {
      if (vuole(`correttore.${campo}`)) $(id).value = String(soglieCorr[campo]);
    }

    if (vuole('timerRingtone')) {
      const ringtone = settings.timerRingtone || 'default';
      const ringOpt = [...$('timerRingtone').options].find((o) => o.value === ringtone);
      $('timerRingtone').value = ringOpt ? ringtone : 'default';
    }
    if (vuole('timerRingtoneVolume')) caricaVolume('timerRingtoneVolume', settings.timerRingtoneVolume);

    const tts = settings.tts || {};
    if (vuole('tts.modelVoice')) populateModelVoices(tts.modelVoice || '');
    if (ttsSupported()) {
      if (vuole('tts.rate')) {
        const rate = Number(tts.rate) || 1;
        $('ttsRate').value = String(rate);
        $('ttsRateVal').textContent = rate.toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
      }
      if (vuole('tts.pitch')) {
        const pitch = Number(tts.pitch) || 1;
        $('ttsPitch').value = String(pitch);
        $('ttsPitchVal').textContent = pitch.toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 });
      }
      if (vuole('tts.voice')) populateVoices(tts.voice || '');
    }
  }

  function shellDiWindows() {
    try { return (window.filo?.sistema || 'win32') === 'win32'; } catch (_) { return true; }
  }

  // PowerShell e cmd esistono solo su Windows. Fuori da lì il comando parte
  // comunque (il main ricade su /bin/sh — vedi src/main/services/terminal.js),
  // ma offrire tre shell di Windows a chi sta su un Mac è un menu che mente:
  // qui si mostrano quelle vere. Il valore salvato di una macchina Windows
  // (es. "powershell") si legge come "la shell di sistema".
  function preparaShell() {
    if (shellDiWindows()) return;
    const sel = $('terminalShell');
    sel.innerHTML = '';
    for (const [value, label] of [['sh', 'Shell di sistema (sh)'], ['bash', 'Bash']]) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      sel.appendChild(o);
    }
  }

  // ── Memoria di Filo: si legge e si corregge nel quaderno delle memorie (#872) ─────────
  function apriQuaderno() {
    try { chrome.tabs.create({ url: 'filo://quaderno/quaderno.html' }); } catch (_) {}
  }
  function apriNovita() {
    try { chrome.tabs.create({ url: 'filo://novita/novita.html' }); } catch (_) {}
  }

  // ── Ricerca nei documenti (#947) ─────────────────────────────────────────
  // L'elenco delle cartelle si salva a ogni gesto, fuori dai campi in sospeso. Le tre di sistema tolte restano
  // sbiadite con «Rimetti»: quello che si toglie si deve poter rimettere da qui.
  const CARTELLE_DI_SERIE = { documenti: 'Documenti', download: 'Download', scrivania: 'Scrivania' };
  let cartelleSalvate = null;
  let statoDocumenti = null;
  let giroStato = null;

  function rigaCartella(voce, { tolta = false } = {}) {
    const row = document.createElement('div');
    row.className = `mem-riga${tolta ? ' doc-tolta' : ''}`;
    row.dataset.cartella = voce;
    const t = document.createElement('span');
    t.className = 'mem-testo';
    const nome = CARTELLE_DI_SERIE[voce] || voce.split(/[\\/]/).filter(Boolean).pop() || voce;
    t.textContent = nome;
    const info = statoDocumenti && Array.isArray(statoDocumenti.cartelle)
      ? statoDocumenti.cartelle.find((c) => c.voce === voce) : null;
    const dove = document.createElement('span');
    dove.className = 'doc-dove';
    dove.textContent = tolta ? 'tolta: Filo non ci cerca'
      : (info && !info.esiste ? `${info.percorso ? `${info.percorso} · ` : ''}non c'è su questo computer`
        : (info && info.negata ? `il sistema non lascia leggere questa cartella a Filo · ${statoDocumenti.comePermesso || 'dagli il permesso nelle impostazioni del sistema'}`
          : ((info && info.percorso) || (CARTELLE_DI_SERIE[voce] ? '' : voce))));
    if (info && info.negata && !tolta) { dove.classList.add('doc-negata'); dove.title = info.percorso || ''; }
    if (dove.textContent) t.appendChild(dove);
    row.appendChild(t);
    const b = document.createElement('button');
    b.type = 'button';
    if (tolta) {
      b.className = 'doc-rimetti';
      b.textContent = 'Rimetti';
      b.title = `Cerca di nuovo in ${nome}`;
      b.addEventListener('click', () => salvaCartelle([...(cartelleSalvate || []), voce]));
    } else {
      b.className = 'mem-via';
      b.textContent = '×';
      b.title = 'Togli';
      b.setAttribute('aria-label', `Togli la cartella ${nome}`);
      b.addEventListener('click', () => salvaCartelle((cartelleSalvate || []).filter((x) => x !== voce)));
    }
    row.appendChild(b);
    return row;
  }

  function disegnaCartelle(elenco) {
    const box = $('documentiCartelle');
    if (!box) return;
    cartelleSalvate = Array.isArray(elenco) ? elenco.filter((x) => typeof x === 'string' && x.trim()) : [];
    box.textContent = '';
    if (!cartelleSalvate.length) {
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = 'Nessuna cartella: Filo non cerca fra i tuoi documenti.';
      box.appendChild(p);
    }
    for (const v of cartelleSalvate) box.appendChild(rigaCartella(v));
    for (const v of Object.keys(CARTELLE_DI_SERIE)) {
      if (!cartelleSalvate.includes(v)) box.appendChild(rigaCartella(v, { tolta: true }));
    }
    const cercate = $('documentiCercate');
    if (cercate) {
      const occasionali = statoDocumenti && Array.isArray(statoDocumenti.occasionali) ? statoDocumenti.occasionali : [];
      cercate.textContent = '';
      for (const o of occasionali) cercate.appendChild(rigaOccasionale(o));
      cercate.hidden = !occasionali.length;
    }
  }

  // #947.3 — una cartella fuori elenco in cui l'utente ha chiesto di cercare: Filo tiene quello che ne ha già letto,
  // e qui lo si vede e lo si dimentica.
  function rigaOccasionale(o) {
    const row = document.createElement('div');
    row.className = 'mem-riga doc-occasionale';
    row.dataset.occasionale = o.percorso;
    const t = document.createElement('span');
    t.className = 'mem-testo';
    t.textContent = o.nome || o.percorso;
    const dove = document.createElement('span');
    dove.className = 'doc-dove';
    const n = Number(o.documenti) || 0;
    const quanti = n === 1 ? 'un documento già letto' : `${cifre(n)} documenti già letti`;
    dove.textContent = `${o.percorso} · ci hai cercato tu · ${quanti}${o.esiste ? '' : ' · ora non c\'è'}`;
    t.appendChild(dove);
    row.appendChild(t);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mem-via';
    b.textContent = '×';
    b.title = 'Dimentica';
    b.setAttribute('aria-label', `Dimentica i documenti letti in ${o.nome || o.percorso}`);
    b.addEventListener('click', () => dimenticaCartella(b, o.percorso));
    row.appendChild(b);
    return row;
  }

  async function dimenticaCartella(b, percorso) {
    b.disabled = true;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.DOCUMENTI_DIMENTICA, percorso }); } catch (_) { r = null; }
    const hint = $('documentiHint');
    if (hint) hint.textContent = r && r.ok && r.tolta ? 'Dimenticata' : 'Non c\'era più: ecco com\'è adesso';
    flashSaved('documentiHint');
    await caricaStatoDocumenti();
  }

  function scriviStatoDocumenti() {
    const el = $('documentiStato');
    if (!el || !statoDocumenti) return;
    const s = statoDocumenti;
    const cifre = (x) => Number(x).toLocaleString('it-IT', { useGrouping: true });
    const n = Number(s.documenti) || 0;
    let t = n === 1 ? 'Un documento' : `${cifre(n)} documenti`;
    if (s.scansioni) t += `, di cui ${cifre(s.scansioni)} ${s.scansioni === 1 ? 'scansione' : 'scansioni'} senza testo`;
    if (s.inCorso && s.inCorso.totali) t += ` · ne sto leggendo ${cifre(Math.min(s.inCorso.fatti + 1, s.inCorso.totali))} di ${cifre(s.inCorso.totali)}`;
    el.textContent = cartelleSalvate && cartelleSalvate.length ? t : '';
  }

  async function caricaStatoDocumenti() {
    if (!$('documentiCartelle')) return;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.DOCUMENTI_STATO }); } catch (_) { r = null; }
    if (!r || !r.ok) return;
    statoDocumenti = r;
    if (cartelleSalvate) disegnaCartelle(cartelleSalvate);
    scriviStatoDocumenti();
    // Mentre legge, il conto si muove: la pagina lo chiede finché il giro non finisce.
    clearTimeout(giroStato);
    if (r.inCorso && !document.hidden) giroStato = setTimeout(caricaStatoDocumenti, 1500);
  }

  async function salvaCartelle(nuovo) {
    const elenco = Array.from(new Set(nuovo));
    disegnaCartelle(elenco);
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { documenti: { cartelle: elenco } } });
    const hint = $('documentiHint');
    if (hint) hint.textContent = 'Salvato';
    flashSaved('documentiHint');
    setTimeout(caricaStatoDocumenti, 400);
  }

  async function aggiungiCartella() {
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.DOCUMENTI_SCEGLI_CARTELLA }); } catch (_) { r = null; }
    if (!r || !r.ok || !r.percorso) return;
    if ((cartelleSalvate || []).includes(r.percorso)) {
      const hint = $('documentiHint');
      if (hint) hint.textContent = 'Salvato';
      flashSaved('documentiHint');
      return;
    }
    await salvaCartelle([...(cartelleSalvate || []), r.percorso]);
  }

  // ── Siti dove il tasto destro apre il loro menu (#975) ───────────────────
  // Si aggiungono dal tasto destro sul sito o chiedendolo a Filo; qui si vedono tutti e si tolgono.
  let sitiMenuSalvati = null;

  function disegnaSitiMenu(elenco) {
    const box = $('menuDelSitoSiti');
    if (!box) return;
    sitiMenuSalvati = Array.isArray(elenco) ? elenco.filter((x) => typeof x === 'string' && x.trim()) : [];
    box.textContent = '';
    const tasto = $('menuDelSitoTasto');
    if (tasto) tasto.textContent = window.SN_TASTI ? window.SN_TASTI.etichetta('Shift') : 'Shift';
    if (!sitiMenuSalvati.length) {
      const p = document.createElement('p');
      p.className = 'sn-muted';
      p.textContent = 'Nessun sito. Lo aggiungi da «Menu di …» in cima al menu di Filo, o chiedendolo a Filo.';
      box.appendChild(p);
    }
    for (const sito of sitiMenuSalvati) {
      const row = document.createElement('div');
      row.className = 'mem-riga';
      row.dataset.sito = sito;
      const t = document.createElement('span');
      t.className = 'mem-testo';
      t.textContent = (window.SN_NOMI_SITO && window.SN_NOMI_SITO.leggibile(sito)) || sito;
      row.appendChild(t);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mem-via';
      b.textContent = '×';
      b.title = 'Torna al menu di Filo';
      b.setAttribute('aria-label', `Su ${t.textContent} torna al menu di Filo`);
      b.addEventListener('click', () => salvaSitiMenu((sitiMenuSalvati || []).filter((x) => x !== sito)));
      row.appendChild(b);
      box.appendChild(row);
    }
  }

  async function salvaSitiMenu(nuovo) {
    const elenco = Array.from(new Set(nuovo));
    disegnaSitiMenu(elenco);
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { menuDelSito: { siti: elenco } } });
    flashSaved('menuDelSitoHint');
  }

  // ── Scorciatoie di Spiega, Traduci, Salva per dopo e Aiuto (#842) ────────
  // Si cambiano premendo i tasti nuovi; lettura e controlli stanno in SN_TASTI, gli stessi della chat. Mentre si
  // registra, il main lascia arrivare qui anche i tasti che prende prima della pagina: Ctrl+T si rifiuta col perché.
  let scorciatoieSalvate = {};
  let registrando = null;

  // Gli elementi dei pannelli delle app tengono le loro combinazioni (#1433): una delle quattro sopra le spegnerebbe.
  const PANNELLI = 'sn_pannelli_app';
  async function caricaModuliEditor() {
    try {
      const r = await chrome.storage.local.get(PANNELLI);
      window.SN_TASTI?.usaScorciatoiePannelli(r && r[PANNELLI]);
    } catch (_) {}
  }

  function rigaScorciatoia(id) {
    return document.querySelector(`#scorciatoieFilo .sc-riga[data-azione="${id}"]`);
  }

  // I tasti di una combinazione come tasti veri, uno per pezzo.
  function mostraTasti(el, etichetta) {
    el.textContent = '';
    String(etichetta).split('+').forEach((pezzo, i) => {
      if (i) {
        const piu = document.createElement('span');
        piu.className = 'sc-piu';
        piu.textContent = '+';
        el.appendChild(piu);
      }
      const k = document.createElement('kbd');
      k.className = 'sc-kbd';
      k.textContent = pezzo;
      el.appendChild(k);
    });
  }

  function mostraErroreScorciatoia(id, testo) {
    const riga = rigaScorciatoia(id);
    const err = riga && riga.querySelector('.sc-errore');
    if (!err) return;
    err.textContent = testo || '';
    err.hidden = !testo;
  }

  function disegnaScorciatoie(mappa) {
    const box = $('scorciatoieFilo');
    const T = window.SN_TASTI;
    if (!box || !T) return;
    scorciatoieSalvate = { ...((mappa && typeof mappa === 'object') ? mappa : {}) };
    T.usaScorciatoieFilo(scorciatoieSalvate);
    // La riga in ascolto non si ridisegna sotto le dita: lo fa chi chiude l'ascolto.
    if (registrando) return;
    box.textContent = '';
    for (const s of T.scorciatoieFilo()) {
      const riga = document.createElement('div');
      riga.className = `sc-riga${s.diSerie ? '' : ' sc-cambiata'}`;
      riga.dataset.azione = s.id;

      const nome = document.createElement('span');
      nome.className = 'sc-nome';
      nome.textContent = s.nome;

      const tasti = document.createElement('button');
      tasti.type = 'button';
      tasti.className = 'sc-tasti';
      tasti.title = 'Cambia';
      tasti.setAttribute('aria-label', `${s.nome}: ${s.etichetta}. Premi per cambiarla`);
      mostraTasti(tasti, s.etichetta);
      tasti.addEventListener('click', () => avviaRegistrazione(s.id));
      tasti.addEventListener('blur', () => { if (registrando && registrando.id === s.id) fermaRegistrazione(); });

      const serie = T.etichettaFilo(s.serie);
      const rip = document.createElement('button');
      rip.type = 'button';
      rip.className = 'sc-ripristina';
      rip.textContent = '↺';
      rip.title = `Rimetti ${serie}`;
      rip.setAttribute('aria-label', `Rimetti ${serie} per ${s.nome}`);
      rip.hidden = s.diSerie;
      rip.addEventListener('click', () => salvaScorciatoia(s.id, s.serie));

      const err = document.createElement('span');
      err.className = 'sc-errore';
      err.setAttribute('role', 'alert');
      err.hidden = true;

      riga.append(nome, tasti, rip, err);
      box.appendChild(riga);
    }
  }

  // Il main tiene l'ascolto al più un minuto: finché la riga ascolta lo si rinnova.
  function chiediTasti(attivo) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.REGISTRA_TASTI, attivo })).catch(() => {}); } catch (_) {}
  }

  function avviaRegistrazione(id) {
    if (registrando && registrando.id === id) return;
    fermaRegistrazione();
    const riga = rigaScorciatoia(id);
    if (!riga) return;
    const tasti = riga.querySelector('.sc-tasti');
    registrando = { id, tasti, ctrlZ: document.documentElement.dataset.filoCtrlZ, rinnovo: setInterval(() => chiediTasti(true), 20000) };
    // Ctrl+Z qui è un tasto da registrare, non «torna alla pagina di prima».
    document.documentElement.dataset.filoCtrlZ = 'pagina';
    chiediTasti(true);
    caricaModuliEditor();
    riga.classList.add('sc-registra');
    mostraErroreScorciatoia(id, '');
    attesaTasti();
    tasti.focus();
  }

  function attesaTasti(mods) {
    if (!registrando) return;
    const el = registrando.tasti;
    if (mods && mods.length) { mostraTasti(el, [...mods, '…'].join('+')); return; }
    el.textContent = '';
    const s = document.createElement('span');
    s.className = 'sc-attesa';
    s.textContent = 'Premi i tasti…';
    el.appendChild(s);
  }

  function fermaRegistrazione() {
    if (!registrando) return;
    const r = registrando;
    registrando = null;
    clearInterval(r.rinnovo);
    if (r.ctrlZ === undefined) delete document.documentElement.dataset.filoCtrlZ;
    else document.documentElement.dataset.filoCtrlZ = r.ctrlZ;
    chiediTasti(false);
    const tornaIlFuoco = document.activeElement === r.tasti;
    disegnaScorciatoie(scorciatoieSalvate);
    if (tornaIlFuoco) { const t = rigaScorciatoia(r.id)?.querySelector('.sc-tasti'); if (t) t.focus(); }
  }

  // I modificatori tenuti premuti, coi nomi di questa tastiera.
  function modificatoriPremuti(e) {
    const mac = window.SN_TASTI.suMac();
    const [meta, ctrl] = [e.metaKey, e.ctrlKey];
    const out = [];
    if (meta) out.push(mac ? 'Cmd' : 'Win');
    if (ctrl) out.push('Ctrl');
    if (e.altKey) out.push(mac ? 'Opzione' : 'Alt');
    if (e.shiftKey) out.push('Shift');
    return out;
  }

  function tastoRegistrato(e) {
    if (!registrando) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.isComposing || e.repeat) return;
    const T = window.SN_TASTI;
    const libero = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (libero && (e.key === 'Escape' || e.key === 'Tab')) { fermaRegistrazione(); return; }
    const r = T.scorciatoiaDaEvento(e);
    if (!r) return;
    if (r.attesa) { attesaTasti(modificatoriPremuti(e)); return; }
    const no = r.rifiuto || T.rifiutoScorciatoiaFilo(registrando.id, r.accel);
    if (no) {
      attesaTasti();
      mostraErroreScorciatoia(registrando.id, T.testoRifiutoFilo(no));
      return;
    }
    salvaScorciatoia(registrando.id, r.accel);
  }

  async function salvaScorciatoia(id, accel) {
    const T = window.SN_TASTI;
    const no = T.rifiutoScorciatoiaFilo(id, accel);
    if (no) { mostraErroreScorciatoia(id, T.testoRifiutoFilo(no)); return; }
    await salvaMappaScorciatoie({ [id]: T.valoreDaSalvare(id, accel) }, id);
  }

  async function salvaMappaScorciatoie(richiesto, id) {
    const T = window.SN_TASTI;
    await caricaModuliEditor();
    // «Ripristina» ne tocca quattro: quella che non può tornare di serie resta com'è, col perché sulla sua riga.
    const dopo = Object.fromEntries(T.AZIONI_FILO.map((a) => {
      const v = Object.prototype.hasOwnProperty.call(richiesto, a.id) ? richiesto[a.id] : scorciatoieSalvate[a.id];
      return [a.id, v || a.serie];
    }));
    const cambio = {};
    const rifiutate = [];
    for (const [x, v] of Object.entries(richiesto)) {
      const no = T.rifiutoScorciatoiaFilo(x, v || T.AZIONI_FILO.find((a) => a.id === x).serie, undefined, dopo);
      if (no) rifiutate.push([x, T.testoRifiutoFilo(no)]);
      else cambio[x] = v;
    }
    const mostraRifiutate = () => { for (const [x, testo] of rifiutate) mostraErroreScorciatoia(x, testo); };
    if (!Object.keys(cambio).length) { if (registrando) fermaRegistrazione(); mostraRifiutate(); return; }
    scorciatoieSalvate = { ...scorciatoieSalvate, ...cambio };
    if (registrando) fermaRegistrazione();
    else disegnaScorciatoie(scorciatoieSalvate);
    const r = await Promise.resolve(chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { scorciatoie: cambio } })).catch(() => null);
    if (r && r.ok) {
      flashSaved('scorciatoieHint');
      disegnaScorciatoie(r.settings && r.settings.scorciatoie);
      mostraRifiutate();
    } else if (id) {
      mostraErroreScorciatoia(id, 'Non sono riuscito a salvarla: riprova.');
    }
  }

  function vociScorciatoia(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const riga = el && el.closest ? el.closest('#scorciatoieFilo .sc-riga') : null;
    const T = window.SN_TASTI;
    const s = riga && T ? T.scorciatoieFilo().find((x) => x.id === riga.dataset.azione) : null;
    if (!s) return [];
    const voci = [{ type: 'item', label: `Cambia la scorciatoia di «${s.nome}»`, onClick: () => avviaRegistrazione(s.id) }];
    if (!s.diSerie) voci.push({ type: 'item', label: `Rimetti ${T.etichettaFilo(s.serie)}`, onClick: () => salvaScorciatoia(s.id, s.serie) });
    return voci;
  }
  window.SN_VOCI_PAGINA = Array.isArray(window.SN_VOCI_PAGINA) ? window.SN_VOCI_PAGINA : [];
  if (!window.SN_VOCI_PAGINA.includes(vociScorciatoia)) window.SN_VOCI_PAGINA.push(vociScorciatoia);

  let caricato = false;

  // ── Autonomia di Filo (#530) ─────────────────────────────────────────────
  // Alzare il livello vuole «conferma», abbassarlo no: lo dice SN_AUTONOMIA, non questa pagina.
  // La scelta parte subito e da sola, fuori dai campi in sospeso: un livello mezzo confermato non esiste.
  const Autonomia = window.SN_AUTONOMIA;
  let livelloSalvato = Autonomia ? Autonomia.LIVELLO_PREDEFINITO : 'default';
  let sceltaInCorso = false;

  function disegnaAutonomia() {
    const box = $('autonomiaLivelli');
    if (!box || !Autonomia) return;
    box.textContent = '';
    for (const l of Autonomia.livelliSelezionabili()) {
      const label = document.createElement('label');
      label.className = 'sn-cookie-mode';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'autonomia';
      input.value = l.id;
      input.id = `autonomia-${l.id}`;
      input.addEventListener('change', () => { if (input.checked) scegliAutonomia(l.id); });
      const testo = document.createElement('span');
      const nome = document.createElement('span');
      nome.className = 'sn-cookie-mode-label';
      nome.textContent = l.nome;
      const frase = document.createElement('span');
      frase.className = 'sn-muted sn-cookie-mode-desc';
      frase.textContent = l.frase;
      testo.append(nome, frase);
      label.append(input, testo);
      box.appendChild(label);
    }
  }

  function mostraAutonomia(livello) {
    if (!Autonomia) return;
    livelloSalvato = Autonomia.livelloAttivo(livello);
    const r = $(`autonomia-${livelloSalvato}`);
    if (r) r.checked = true;
  }

  async function scegliAutonomia(nuovo) {
    if (sceltaInCorso || nuovo === livelloSalvato) return;
    const serve = Autonomia.richiestaCambioLivello(livelloSalvato, nuovo);
    if (serve === 'no') { mostraAutonomia(livelloSalvato); return; }
    if (serve === 'conferma') {
      sceltaInCorso = true;
      const Ui = window.SN_CONFIRM_UI;
      let ok = false;
      try {
        ok = Ui ? await Ui.confirmTyped(Autonomia.confermaAlzata(nuovo)) : false;
      } finally { sceltaInCorso = false; }
      if (!ok) { mostraAutonomia(livelloSalvato); return; }
    }
    mostraAutonomia(nuovo);
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { autonomia: { livello: nuovo } } });
    flashSaved('autonomiaHint');
  }

  async function load() {
    const settings = await Storage.getSettings();
    disegnaAutonomia();
    mostraAutonomia(settings.autonomia && settings.autonomia.livello);
    buildPresetOptions();
    preparaShell();
    $('aggiornamentiQuando').hidden = !shellDiWindows();
    populateNotifSounds();
    if (!ttsSupported()) {
      const u = $('ttsUnsupported');
      if (u) u.hidden = false;
      ['ttsVoice', 'ttsRate', 'ttsPitch', 'ttsPreview'].forEach((id) => {
        const el = $(id);
        if (el) el.disabled = true;
      });
    }
    riempi(settings);
    disegnaCartelle(settings.documenti && settings.documenti.cartelle);
    caricaStatoDocumenti();
    disegnaSitiMenu(settings.menuDelSito && settings.menuDelSito.siti);
    disegnaScorciatoie(settings.scorciatoie);

    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);

    currentOverrides = { ...(settings.themeTokens || {}) };
    buildTokenSection();

    currentTabColor = TabColor
      ? TabColor.clampParams(settings.tabColor || {})
      : { ...(settings.tabColor || {}) };
    buildTabColorSection();
    caricato = true;
    guardaLeAvanzate();
    // La sezione chiesta dall'indirizzo (la carta dell'aggiornamento manda a #sec-aggiornamenti) si raggiunge solo
    // adesso: le sezioni costruite qui sopra l'hanno spostata in giù dopo lo scorrimento del browser.
    try {
      const sezione = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (sezione) sezione.scrollIntoView();
    } catch (_) {}
  }

  // Un cambio arrivato da altrove: si riscrive solo quello che è davvero
  // cambiato e che l'utente non sta toccando qui, così il cursore non salta.
  function riallinea(settings) {
    if (!caricato || !settings) return;
    if (!sceltaInCorso) mostraAutonomia(settings.autonomia && settings.autonomia.livello);
    riempi(settings, (k) => !toccati.has(k) && valoreDelCampo(k) !== valoreSalvato(settings, k));
    riallineaToken(settings.themeTokens);
    riallineaTabColor(settings.tabColor);
    const cartelle = settings.documenti && settings.documenti.cartelle;
    if (JSON.stringify(cartelle || []) !== JSON.stringify(cartelleSalvate || [])) {
      disegnaCartelle(cartelle);
      setTimeout(caricaStatoDocumenti, 400);
    }
    const sitiMenu = settings.menuDelSito && settings.menuDelSito.siti;
    if (JSON.stringify(sitiMenu || []) !== JSON.stringify(sitiMenuSalvati || [])) disegnaSitiMenu(sitiMenu);
    if (JSON.stringify(settings.scorciatoie || {}) !== JSON.stringify(scorciatoieSalvate)) disegnaScorciatoie(settings.scorciatoie);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Prima di ogni altro ascoltatore: quando parte persist() il campo è già segnato.
    for (const [id, k] of Object.entries(CAMPO_DI)) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('input', () => toccati.add(k));
      el.addEventListener('change', () => toccati.add(k));
    }
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.SETTINGS_UPDATED && msg.settings) riallinea(msg.settings);
        // L'archivio delle interviste cambia anche da fuori: un «dimentica tutto» in chat, un'intervista che avanza.
        if (msg && msg.type === MSG.FILO_ONBOARDING_UPDATED && msg.onboarding) renderOnboardingArchive(msg.onboarding);
      });
    } catch (_) {}
    load();
    $('apriQuaderno').addEventListener('click', apriQuaderno);
    $('apriNovita').addEventListener('click', apriNovita);
    $('documentiAggiungi').addEventListener('click', aggiungiCartella);
    window.addEventListener('keydown', tastoRegistrato, true);
    window.addEventListener('keyup', (e) => {
      if (!registrando) return;
      e.preventDefault();
      attesaTasti(modificatoriPremuti(e));
    }, true);
    window.addEventListener('blur', fermaRegistrazione);
    $('scorciatoieRipristina').addEventListener('click', () => {
      salvaMappaScorciatoie(Object.fromEntries(window.SN_TASTI.AZIONI_FILO.map((a) => [a.id, ''])));
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) caricaStatoDocumenti(); });

    $('theme').addEventListener('change', () => {
      Bootstrap.applyTheme($('theme').value);
      // I default di alcuni token cambiano col tema: ridisegna le righe. Gli override diretti sono
      // indipendenti dal tema e restano.
      if (Tokens) for (const name of Tokens.names()) renderTokenRow(name);
      persist();
    });
    $('textScale').addEventListener('change', () => {
      Bootstrap.applyTextScale(parseFloat($('textScale').value) || 1);
      persist();
    });
    $('showHomeMessage').addEventListener('change', persist);
    for (const id of ['homeSisOra', 'homeSisBatteria', 'homeSisRete', 'homeSisBluetooth', 'homeSisVolume']) $(id).addEventListener('change', persist);
    $('tabPreviewEnabled').addEventListener('change', () => {
      $('tabPreviewSize').disabled = !$('tabPreviewEnabled').checked;
      persist();
    });
    $('tabPreviewSize').addEventListener('change', persist);
    $('autoArchiveEnabled').addEventListener('change', persist);
    $('autoArchiveOnClose').addEventListener('change', persist);
    $('autoArchiveIdleHours').addEventListener('change', persist);
    $('autoArchiveIdleHours').addEventListener('input', (e) => caselle.cambiato('pref', e));
    // Al blur riallinea il campo al valore realmente salvato (clampato), così
    // un numero fuori scala non resta a schermo a mentire sul valore in uso.
    $('autoArchiveIdleHours').addEventListener('blur', canonAutoArchiveIdle);
    $('riassuntoSchede').addEventListener('change', persist);
    $('terminalEnabled').addEventListener('change', persist);
    $('schermoGuarda').addEventListener('change', persist);
    $('nomiSensatiScaricamenti').addEventListener('change', persist);
    $('aggiornamentiAutomatici').addEventListener('change', persist);
    // Spenta la proposta, «anche in incognito» non ha niente da aggiungere.
    $('propostaEmailAttiva').addEventListener('change', () => {
      $('propostaEmailIncognito').disabled = !$('propostaEmailAttiva').checked;
      persist();
    });
    $('propostaEmailIncognito').addEventListener('change', persist);
    for (const id of ['contestoGiorni', 'contestoToken']) {
      $(id).addEventListener('change', persist);
      $(id).addEventListener('input', (e) => caselle.cambiato('pref', e));
      $(id).addEventListener('blur', canonContesto);
    }
    $('contestoCache').addEventListener('change', persist);
    for (const [, id] of CAMPI_LUNGHEZZA) {
      $(id).addEventListener('change', persist);
      $(id).addEventListener('input', (e) => caselle.cambiato('pref', e));
      $(id).addEventListener('blur', canonLunghezza);
    }
    $('avvisoCreditiAttivo').addEventListener('change', persist);
    $('spiegaAnticipata').addEventListener('change', persist);
    $('descriviImmagini').addEventListener('change', persist);
    $('contatoriAttivi').addEventListener('change', persist);
    for (const [, id] of INTERRUTTORI) $(id).addEventListener('change', persist);
    $('correttoreModello').addEventListener('change', persist);
    $('correttoreRipetizioni').addEventListener('change', persist);
    $('correttoreSegnaposti').addEventListener('change', persist);
    $('correttoreSegnapostiWeb').addEventListener('change', persist);
    for (const [campo, id] of Object.entries(CAMPI_TEMPI_CORRETTORE)) {
      $(id).addEventListener('change', persist);
      // Al blur il campo mostra il valore davvero in uso: uno fuori dai limiti torna dentro, a vista.
      $(id).addEventListener('blur', () => { $(id).value = String(tempiCorrettore({ correttore: { [campo]: $(id).value } })[campo]); });
    }
    $('correttoreAutomatica').addEventListener('change', persist);
    for (const [campo, id] of Object.entries(CAMPI_SOGLIE_CORRETTORE)) {
      $(id).addEventListener('change', persist);
      $(id).addEventListener('blur', () => { $(id).value = String(soglieCorrettore({ correttore: { [campo]: $(id).value } })[campo]); });
    }
    for (const [, id] of CAMPI_CREDITI) {
      $(id).addEventListener('change', persist);
      $(id).addEventListener('input', (e) => caselle.cambiato('pref', e));
      $(id).addEventListener('blur', canonCrediti);
    }
    segnapostiContesto();
    $('terminalShell').addEventListener('change', persist);
    $('barraSpinta').addEventListener('change', persist);
    $('barraStriscia').addEventListener('change', persist);
    $('barraSchede').addEventListener('change', persist);
    for (const [id, campo] of [['barraAttesa', 'attesaMs'], ['barraUscita', 'uscitaMs']]) {
      $(id).addEventListener('change', persist);
      // Al blur il campo mostra il valore davvero in uso: uno fuori dai limiti torna dentro, a vista.
      $(id).addEventListener('blur', () => { $(id).value = String(opzioniBarraLaterale({ [campo]: $(id).value })[campo]); });
    }
    for (const id of ['pannelloSpinta', 'pannelloStriscia', 'pannelloBloccato']) $(id).addEventListener('change', persist);
    for (const [id, campo] of [['pannelloAttesa', 'attesaMs'], ['pannelloUscita', 'uscitaMs']]) {
      $(id).addEventListener('change', persist);
      $(id).addEventListener('blur', () => { $(id).value = String(opzioniPannelloDestro({ [campo]: $(id).value })[campo]); });
    }
    $('avvisoSchermoPienoDurata').addEventListener('change', persist);
    $('avvisoSchermoPienoDurata').addEventListener('blur', () => {
      $('avvisoSchermoPienoDurata').value = String(opzioniAvvisoSchermoPieno({ durataMs: $('avvisoSchermoPienoDurata').value }).durataMs);
    });
    $('aggiornamentiInstalla').addEventListener('change', persist);

    // Lettura ad alta voce: la lista voci può popolarsi in ritardo.
    if (ttsSupported() && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => populateVoices());
    }
    $('ttsVoice').addEventListener('change', persist);
    $('ttsRate').addEventListener('input', (e) => {
      $('ttsRateVal').textContent = (parseFloat($('ttsRate').value) || 1).toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
      caselle.cambiato('pref', e);
    });
    $('ttsPitch').addEventListener('input', (e) => {
      $('ttsPitchVal').textContent = (parseFloat($('ttsPitch').value) || 1).toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 });
      caselle.cambiato('pref', e);
    });
    $('ttsPreview').addEventListener('click', previewTts);
    $('ttsModelPreview').addEventListener('click', previewModelVoice);
    $('ttsModelVoice').addEventListener('change', () => {
      syncCustomVoiceField();
      if ($('ttsModelVoice').value === CUSTOM_VOICE) $('ttsModelVoiceCustom').focus();
      else persist();
    });
    $('ttsModelVoiceCustom').addEventListener('input', (e) => caselle.cambiato('pref', e));
    $('ttsModelVoiceCustom').addEventListener('change', persist);

    $('notifDuration').addEventListener('change', persist);
    $('notifDuration').addEventListener('input', (e) => caselle.cambiato('pref', e));
    $('notifDuration').addEventListener('blur', canonNotifDuration);
    $('notifSoundEnabled').addEventListener('change', persist);
    $('notifSound').addEventListener('change', persist);
    $('notifSoundVolume').addEventListener('input', () => mostraVolume('notifSoundVolume'));
    $('notifSoundVolume').addEventListener('change', persist);
    $('dictationAutoSend').addEventListener('change', persist);
    for (const id of ['dictationSilence', 'dictationCancel']) {
      $(id).addEventListener('input', (e) => { scriviTempiVoce(); caselle.cambiato('pref', e); });
    }
    $('notifSoundPreview').addEventListener('click', previewNotifSound);

    $('timerRingtone').addEventListener('change', persist);
    $('timerRingtoneVolume').addEventListener('input', () => mostraVolume('timerRingtoneVolume'));
    $('timerRingtoneVolume').addEventListener('change', persist);
    $('timerRingtonePreview').addEventListener('click', previewRingtone);

    // Scrivere a mano riallinea la select su «Personalizzato».
    $('agentStylePreset').addEventListener('change', () => {
      const key = $('agentStylePreset').value;
      if (key !== CUSTOM_KEY) {
        const preset = AGENT_STYLE_PRESETS.find((p) => p.key === key);
        $('agentStyleText').value = preset ? preset.text : '';
        syncStyleNote();
      } else {
        $('agentStyleText').focus();
      }
      persist();
    });
    $('agentStyleText').addEventListener('input', (e) => {
      syncPresetSelect();
      if (syncStyleNote()) caselle.cambiato('pref', e);
    });
    // Uscendo dal campo si vede quello che è stato salvato, non un testo con
    // dentro caratteri invisibili o righe vuote in più (gli spazi ai bordi no).
    $('agentStyleText').addEventListener('change', () => {
      const leggibile = currentStyleText();
      if ($('agentStyleText').value.trim() !== leggibile) $('agentStyleText').value = leggibile;
      mostraTuttoLoStile();
    });
    window.addEventListener('resize', mostraTuttoLoStile);

    $('resetAllTokens').addEventListener('click', resetAllTokens);

    const resetTabColorBtn = $('resetAllTabColor');
    if (resetTabColorBtn) resetTabColorBtn.addEventListener('click', resetAllTabColor);

    const resetAllBtn = $('resetAllSettings');
    if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllSettings);

    const onbBtn = $('restartOnboarding');
    if (onbBtn) onbBtn.addEventListener('click', restartOnboarding);
    loadOnboardingArchive();

    // Con tema «Come il sistema» il tema risolto cambia quando l'OS passa chiaro↔scuro:
    // ridisegna le righe, o i default mostrati mentirebbero.
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if ((window.SN_PAGE_THEME || 'system') !== 'system' || !Tokens) return;
        for (const name of Tokens.names()) renderTokenRow(name);
      });
    }
  });
})();
