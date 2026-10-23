// Logica pagina "Altro" — opzioni secondarie spostate qui da Opzioni: i siti dove Filo è spento (blocklist,
// #843) e le categorie, più le scorciatoie alle app. Niente «Salva»: le caselle passano da SN_CASELLE.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  // Quello che si incolla («https://www.Sito.it/x») si riduce come in Sicurezza, e si mostra ridotto.
  const Siti = window.SN_NOMI_SITO;

  function $(id) { return document.getElementById(id); }

  function fillStaticText() {
    document.title = I18n.t('options_title') + ' — ' + I18n.t('options_other');
    $('title').textContent = I18n.t('options_other');
    $('backToModels').textContent = I18n.t('options_back_to_models');
    $('h-correttore').textContent = 'Correttore';
    for (const [id, chiave] of [['spellcheckErrori', 'spell_switch_errori'], ['spellcheckSuggerimenti', 'spell_switch_suggerimenti'], ['spellcheckAutomatica', 'spell_switch_automatica'], ['spellcheckSegnaposti', 'spell_switch_segnaposti']]) {
      $(`${id}-label`).textContent = I18n.t(chiave);
      $(`${id}-desc`).textContent = I18n.t(`${chiave}_desc`);
    }
    $('h-blocklist').textContent = I18n.t('options_blocklist');
    $('blocklistDesc').textContent = I18n.t('options_blocklist_desc');
    $('h-categories').textContent = I18n.t('options_categories');
    $('h-shortcuts').textContent = I18n.t('options_shortcuts');
    $('savedHint').textContent = I18n.t('options_saved');
    $('openHome').textContent = 'Aperti per dopo';
    $('openHistory').textContent = 'Cronologia AI';
    $('openSpellcheck').textContent = 'Gestisci correttore';
  }

  // Le scorciatoie come valgono adesso: le quattro di Filo le sceglie l'utente in Preferenze (#842), e su Mac
  // si premono con altri tasti: i nomi si chiedono a SN_TASTI, mai scritti qui.
  function disegnaScorciatoie(settings) {
    const sc = $('shortcutsList');
    const T = window.SN_TASTI;
    T.usaScorciatoieFilo(settings && settings.scorciatoie);
    sc.textContent = '';
    const righe = [
      ...T.scorciatoieFilo().map((s) => [s.etichetta, s.nome]),
      [T.etichettaSaltoScheda(), T.descrizioneSaltoScheda()],
      [T.etichettaSchedaVicina('dopo'), 'Vai alla scheda successiva'],
      [T.etichettaSchedaVicina('prima'), 'Vai alla scheda precedente'],
      [T.etichettaIndietro(), 'Torna alla pagina precedente'],
      [T.etichettaAvanti(), 'Vai alla pagina successiva'],
      [T.etichettaBarra(), 'Apri e chiudi la barra laterale'],
      [T.etichettaSchermoIntero(), 'Metti e togli lo schermo intero'],
    ];
    for (const [k, v] of righe) {
      const li = document.createElement('li');
      li.textContent = `${k} — ${v}`;
      sc.appendChild(li);
    }
  }

  async function load() {
    fillStaticText();
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    disegnaScorciatoie(settings);
    $('blocklist').value = Siti.testoDaElenco(settings.blocklist);
    mostrato = $('blocklist').value;
    for (const [id, percorso] of INTERRUTTORI) $(id).checked = valoreDi(settings, percorso) !== false;
    $('spellcheckAutomatica').checked = settings.correttore?.automatica !== false;
    await renderCategories();
  }

  async function renderCategories() {
    const list = $('categoriesList');
    list.innerHTML = '';
    caselleCategorie.clear();
    const [catsRes, pagesRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.GET_CATEGORIES }),
      chrome.runtime.sendMessage({ type: MSG.GET_SAVED_PAGES }),
    ]);
    const cats = catsRes?.categories || [];
    const pages = pagesRes?.pages || [];
    const counts = new Map();
    for (const p of pages) {
      const k = p.categoryId || '';
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!cats.length) {
      $('categoriesEmpty').textContent = I18n.t('options_categories_empty');
      $('categoriesEmpty').hidden = false;
      return;
    }
    $('categoriesEmpty').hidden = true;
    for (const c of cats) {
      list.appendChild(renderCategoryRow(c, counts.get(c.id) || 0));
    }
  }

  function renderCategoryRow(cat, count) {
    const row = document.createElement('div');
    row.className = 'sn-cat-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = cat.name;
    row.appendChild(input);

    const meta = document.createElement('span');
    meta.className = 'sn-cat-meta';
    meta.textContent = I18n.t('options_category_pages', count);
    row.appendChild(meta);

    // Il nome scritto vale anche senza «Rinomina» (#590.5): un nome a metà finirebbe nelle altre pagine, quindi parte
    // quando sta fermo o all'uscita, e la lista non si ridisegna sotto il cursore. Il tasto resta e conferma sempre.
    const nome = `categoria:${cat.id}`;
    caselleCategorie.set(input, cat);
    caselle.registra(nome, (uscita) => rinomina(cat, input, { ripristina: uscita }));
    input.addEventListener('input', (e) => {
      avvisoOmonima(input, null);
      caselle.cambiato(nome, e, { pausa: window.SN_CASELLE.PAUSA_LUNGA_MS });
    });
    input.addEventListener('change', () => rinomina(cat, input, { ripristina: true }));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); rinomina(cat, input, { ripristina: true, conferma: true }); }
    });

    const renameBtn = document.createElement('button');
    renameBtn.className = 'sn-btn sn-btn-secondary';
    renameBtn.type = 'button';
    renameBtn.textContent = I18n.t('options_category_rename');
    renameBtn.addEventListener('click', () => rinomina(cat, input, { ripristina: true, conferma: true }));
    row.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'sn-btn sn-btn-secondary';
    deleteBtn.type = 'button';
    deleteBtn.textContent = I18n.t('options_category_delete');
    deleteBtn.addEventListener('click', async () => {
      const text = I18n.t('options_category_delete_confirm', cat.name);
      const ok = window.SN_CONFIRM_UI
        // Il nome della categoria può averlo scritto il modello che le crea: nel suo riquadro (#592.7).
        ? await window.SN_CONFIRM_UI.confirm({ title: I18n.t('options_category_delete'), text, parti: ['Eliminare la categoria', { citazione: String(cat.name || '') }, 'Le schede diventeranno non categorizzate.'], okLabel: I18n.t('options_category_delete') })
        : window.confirm(text); // fallback se il modulo non è caricato
      if (!ok) return;
      await chrome.runtime.sendMessage({ type: MSG.DELETE_CATEGORY, id: cat.id });
      await renderCategories();
    });
    row.appendChild(deleteBtn);

    return row;
  }

  // Un nome vuoto non rinomina: uscendo, la casella torna a dire il nome che la categoria ha davvero. A metà (il Ctrl
  // di un Ctrl+V) resta vuota, perché ci si sta per incollare il nome nuovo. In fila per categoria: il `change` del
  // clic su «Rinomina» parte prima del clic, e la conferma deve vedere com'è finito.
  function rinomina(cat, input, opts) {
    caselle.spedita(`categoria:${cat.id}`);
    cat._coda = (cat._coda || Promise.resolve()).then(() => rinominaOra(cat, input, opts), () => {});
    return cat._coda;
  }

  async function rinominaOra(cat, input, opts) {
    const conferma = !!(opts && opts.conferma);
    const newName = input.value.trim();
    if (!newName) {
      if (opts && opts.ripristina) input.value = cat.name;
      return;
    }
    if (newName !== cat.name) {
      // Un nome già preso fonde le due categorie e non si disfa: parte solo confermato (Rinomina, Invio), mai da solo.
      const r = await chrome.runtime.sendMessage({ type: MSG.RENAME_CATEGORY, id: cat.id, name: newName, unisci: conferma }).catch(() => null);
      if (!r || !r.ok) {
        if (r && r.error === 'name_taken') avvisoOmonima(input, r.category);
        return;
      }
      if (r.category && r.category.id !== cat.id) {
        await renderCategories();
        mostraSalvato();
        return;
      }
      cat.name = newName;
    } else if (!conferma) {
      return;
    }
    mostraSalvato();
  }

  function avvisoOmonima(input, omonima) {
    const meta = input.parentElement.querySelector('.sn-cat-meta');
    if (!meta) return;
    if (meta.dataset.conta === undefined) meta.dataset.conta = meta.textContent;
    meta.textContent = omonima ? I18n.t('options_category_name_taken', omonima.name) : meta.dataset.conta;
    meta.classList.toggle('sn-cat-warn', !!omonima);
  }

  function mostraSalvato() {
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(mostraSalvato._t);
    mostraSalvato._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  // I due segni del correttore e i segnaposti (#1448) stanno insieme qui e nella chat (#1115): ognuno si spegne da solo.
  const INTERRUTTORI = [['spellcheckErrori', 'featureFlags.spellcheck'], ['spellcheckSuggerimenti', 'featureFlags.spellcheckContext'],
    ['spellcheckSegnaposti', 'correttore.segnaposti']];
  const valoreDi = (s, percorso) => percorso.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), s);
  async function salvaInterruttore(id, percorso) {
    const [sezione, voce] = percorso.split('.');
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { [sezione]: { [voce]: $(id).checked } } });
    mostraSalvato();
  }

  // L'elenco come la pagina l'ha letto o scritto l'ultima volta: un cambio arrivato da altrove (la chat, il tasto
  // destro) si mostra solo se qui non si sta scrivendo (#949). Le righe che non sono siti restano al loro posto.
  let mostrato = null;
  let scartate = [];

  function avvisoRighe(righe) {
    const el = $('blocklistError');
    el.textContent = righe.length ? I18n.t('options_blocklist_invalid', righe.join(', ')) : '';
    el.hidden = !righe.length;
  }

  // `riscrivi`: a gesto finito (uscita, incolla) la casella mostra i siti ridotti e dice le righe scartate; mentre
  // si scrive no, perché «faceb» è una riga a metà e il cursore non deve saltare.
  async function save({ riscrivi = false } = {}) {
    const biglietto = caselle.spedita('blocklist');
    const el = $('blocklist');
    const letto = Siti.elencoDaTesto(el.value);
    scartate = letto.scartate;
    if (riscrivi) {
      const testo = Siti.testoDaElenco(letto.valid, letto.scartate);
      if (el.value !== testo) {
        const inFondo = el.selectionEnd === el.value.length;
        el.value = testo;
        if (inFondo || document.activeElement === el) el.setSelectionRange(testo.length, testo.length);
      }
      avvisoRighe(letto.invalid);
    } else if (!letto.invalid.length) {
      avvisoRighe([]);
    }
    mostrato = el.value;
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { blocklist: letto.valid }, mentreScrive: !riscrivi });
    if (caselle.aggiornata('blocklist', biglietto)) mostraSalvato();
  }

  // Domini esclusi e nomi delle categorie non hanno un «Salva», e chiudere la scheda non avvisa la pagina (#590.5).
  // Il nome svuotato può essere già partito col fuoco uscito dalla finestra: all'uscita vera la casella lo ridice.
  const caselleCategorie = new Map();
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      for (const [input, cat] of caselleCategorie) if (!input.value.trim()) input.value = cat.name;
    },
    spegni: () => $('savedHint').classList.remove('sn-show'),
  });
  caselle.registra('blocklist', (avvisi) => save({ riscrivi: avvisi === true }));

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.SETTINGS_UPDATED && msg.settings) disegnaScorciatoie(msg.settings);
      if (!msg || msg.type !== MSG.SETTINGS_UPDATED || !msg.settings || mostrato === null) return;
      const el = $('blocklist');
      const scritti = Siti.elencoDaTesto(el.value).valid;
      // Uno stesso elenco con altre righe vuote non si riscrive: chi scrive perderebbe l'a capo appena battuto.
      const tieniElenco = el.value !== mostrato || JSON.stringify(scritti) === JSON.stringify(msg.settings.blocklist || []);
      const toccati = window.SN_VOCI_IMPOSTAZIONI.riallineaPagina('altro', msg.settings, {
        salta: (id) => id === 'blocklist' && tieniElenco,
        elenco: (_id, lista) => Siti.testoDaElenco(lista, scartate),
      });
      if (toccati.includes('blocklist')) mostrato = el.value;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // Un indirizzo incollato è un gesto finito: si riduce subito, come all'uscita.
    $('blocklist').addEventListener('input', (e) => {
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') { save({ riscrivi: true }); return; }
      caselle.cambiato('blocklist', e);
    });
    $('blocklist').addEventListener('change', () => save({ riscrivi: true }));
    for (const [id, percorso] of INTERRUTTORI) $(id).addEventListener('change', () => salvaInterruttore(id, percorso));
    // La correzione automatica a fine parola (#1447): accesa di serie, si spegne da sola.
    $('spellcheckAutomatica').addEventListener('change', async () => {
      await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { correttore: { automatica: $('spellcheckAutomatica').checked } } });
      mostraSalvato();
    });
    // #252 — indirizzo canonico filo://<page>/<file> (non la forma legacy
    // filo://src/pages/…): un solo URL per pagina, e la scheda già aperta viene
    // riportata a fuoco invece di duplicarla.
    $('openHome').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://home/home.html' });
    });
    $('openHistory').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://history/history.html' });
    });
    $('openArchive').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://quaderno/quaderno.html' });
    });
    $('openSpellcheck').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://spellcheck/spellcheck.html' });
    });
    $('cambiaScorciatoie').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://preferences/preferences.html#sec-scorciatoie' });
    });
  });
})();
