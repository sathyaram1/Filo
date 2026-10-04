// Logica pagina "Altro" — opzioni secondarie spostate qui da Opzioni:
// domini esclusi (blocklist) e gestione categorie, più le scorciatoie alle
// app (Aperti per dopo, Cronologia AI, Correttore). Niente «Salva»: le caselle passano da SN_CASELLE.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;

  function $(id) { return document.getElementById(id); }

  function fillStaticText() {
    document.title = I18n.t('options_title') + ' — ' + I18n.t('options_other');
    $('title').textContent = I18n.t('options_other');
    $('backToModels').textContent = I18n.t('options_back_to_models');
    $('h-blocklist').textContent = I18n.t('options_blocklist');
    $('h-categories').textContent = I18n.t('options_categories');
    $('h-shortcuts').textContent = I18n.t('options_shortcuts');
    $('savedHint').textContent = I18n.t('options_saved');
    $('openHome').textContent = 'Aperti per dopo';
    $('openHistory').textContent = 'Cronologia AI';
    $('openSpellcheck').textContent = 'Gestisci correttore';

    // Lista scorciatoie da tastiera. Su Mac le stesse si premono con altri
    // tasti (vedi src/shared/tasti.js): l'elenco deve dire quello che funziona
    // DAVVERO sulla macchina di chi lo sta leggendo, quindi i nomi si chiedono
    // alla regola invece di scriverli.
    const sc = $('shortcutsList');
    sc.innerHTML = '';
    const T = window.SN_TASTI;
    const tasti = (accel) => (T ? T.etichetta(accel) : accel);
    [
      [tasti('Alt+E'), I18n.t('options_action_explain')],
      [tasti('Alt+T'), I18n.t('options_action_translate_sel')],
      [tasti('Alt+S'), 'Salva per dopo'],
      [tasti('Alt+H'), I18n.t('options_action_help') + ' (Fase 2)'],
      [
        T ? T.etichettaSaltoScheda() : 'Alt+cifra',
        T ? T.descrizioneSaltoScheda() : 'Vai alla scheda in quella posizione (0 = la decima)',
      ],
      [T ? T.etichettaIndietro() : 'Alt+\u2190', 'Torna alla pagina precedente'],
      [T ? T.etichettaAvanti() : 'Alt+\u2192', 'Vai alla pagina successiva'],
    ].forEach(([k, v]) => {
      const li = document.createElement('li');
      li.textContent = `${k} — ${v}`;
      sc.appendChild(li);
    });
  }

  async function load() {
    fillStaticText();
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    $('blocklist').value = (settings.blocklist || []).join('\n');
    mostrato = $('blocklist').value;
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
        ? await window.SN_CONFIRM_UI.confirm({ title: I18n.t('options_category_delete'), text, okLabel: I18n.t('options_category_delete') })
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

  // L'elenco come la pagina l'ha letto o scritto l'ultima volta: un cambio arrivato da altrove (la chat)
  // si mostra solo se qui non si sta scrivendo (#949).
  let mostrato = null;

  async function save() {
    caselle.spedita('blocklist');
    mostrato = $('blocklist').value;
    const blocklist = $('blocklist').value.split('\n').map((s) => s.trim()).filter(Boolean);
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { blocklist } });
    mostraSalvato();
  }

  // Domini esclusi e nomi delle categorie non hanno un «Salva», e chiudere la scheda non avvisa la pagina (#590.5).
  // Il nome svuotato può essere già partito col fuoco uscito dalla finestra: all'uscita vera la casella lo ridice.
  const caselleCategorie = new Map();
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      for (const [input, cat] of caselleCategorie) if (!input.value.trim()) input.value = cat.name;
    },
  });
  caselle.registra('blocklist', () => save());

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== MSG.SETTINGS_UPDATED || !msg.settings || mostrato === null) return;
      const el = $('blocklist');
      if ((document.hasFocus() && document.activeElement === el) || el.value !== mostrato) return;
      const toccati = window.SN_VOCI_IMPOSTAZIONI.riallineaPagina('altro', msg.settings);
      if (toccati.length) mostrato = el.value;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('blocklist').addEventListener('input', (e) => caselle.cambiato('blocklist', e));
    $('blocklist').addEventListener('change', () => save());
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
      chrome.tabs.create({ url: 'filo://archive/archive.html' });
    });
    $('openSpellcheck').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://spellcheck/spellcheck.html' });
    });
  });
})();
