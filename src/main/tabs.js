// Tab manager: ogni tab è una WebContentsView attaccata alla BrowserWindow,
// posizionata sotto la "shell" (tab bar + barra indirizzi).
// La shell parla con il main via IPC (tabs:* canali); il main risponde con
// broadcast tabs:updated alla shell perché ridisegni la barra.

const { WebContentsView, Menu, MenuItem } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page-preload.js');
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

// Pagine interne su cui i content script (e quindi il menu Filo del tasto
// destro) NON vengono iniettati — vedi CS_BLOCKLIST in internal-preload.js.
// Qui forniamo un menu contestuale nativo così il tasto destro fa qualcosa
// (taglia/copia/incolla) invece di restare inerte, es. nell'editor.
const NATIVE_MENU_PAGES = [
  'filo://options/', 'filo://history/', 'filo://feedback/',
  'filo://spellcheck/', 'filo://editor/',
];

function buildNativeContextMenu(wc, params) {
  const { editFlags = {}, isEditable, selectionText, misspelledWord, dictionarySuggestions } = params;
  const menu = new Menu();
  if (misspelledWord && Array.isArray(dictionarySuggestions) && dictionarySuggestions.length) {
    for (const s of dictionarySuggestions.slice(0, 5)) {
      menu.append(new MenuItem({ label: s, click: () => wc.replaceMisspelling(s) }));
    }
    menu.append(new MenuItem({ type: 'separator' }));
  }
  const hasSel = !!(selectionText && selectionText.trim());
  if (isEditable) menu.append(new MenuItem({ label: 'Taglia', role: 'cut', enabled: !!editFlags.canCut }));
  if (isEditable || hasSel) menu.append(new MenuItem({ label: 'Copia', role: 'copy', enabled: !!editFlags.canCopy }));
  if (isEditable) menu.append(new MenuItem({ label: 'Incolla', role: 'paste', enabled: !!editFlags.canPaste }));
  if (isEditable || hasSel) {
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Seleziona tutto', role: 'selectAll' }));
  }
  return menu.items.length ? menu : null;
}

class TabManager {
  constructor(window, shellView, { shellHeight = 88 } = {}) {
    this.win = window;
    this.shellView = shellView; // WebContentsView della shell — per il broadcast tabs:updated
    this.shellHeight = shellHeight;
    this.tabs = []; // [{ id, view, title, url, favicon, loading, canBack, canFwd }]
    this.activeId = null;
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────

  openTab(url = 'filo://newtab/', { activate = true } = {}) {
    const id = randomUUID();
    const isInternal = url.startsWith('filo://');
    const view = new WebContentsView({
      webPreferences: {
        preload: isInternal ? INTERNAL_PRELOAD : PAGE_PRELOAD,
        // Per le pagine interne (filo://) usiamo contextIsolation:false così
        // possiamo overwritare window.chrome direttamente — i file portati
        // dall'estensione si aspettano chrome.* in scope globale. Le pagine
        // web esterne mantengono l'isolation (codice non fidato).
        contextIsolation: !isInternal,
        sandbox: false,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    const tab = {
      id,
      view,
      title: 'Nuova scheda',
      url,
      favicon: '',
      loading: true,
      canBack: false,
      canFwd: false,
      isInternal,
    };

    this._wireEvents(tab);
    this.win.contentView.addChildView(view);
    this.tabs.push(tab);

    // IMPORTANTE: setBounds PRIMA di loadURL così la WebContentsView ha una
    // dimensione valida quando il compositor alloca il display surface.
    // Caricare con bounds 0x0 può far andare in fallimento le capturePage
    // successive con "Current display surface not available".
    if (activate) {
      this.activeId = id;
      this.layout();
    }
    view.webContents.loadURL(url);
    if (activate) {
      // Riaffermo la visibilità su tutti i tab dopo loadURL.
      for (const t of this.tabs) t.view.setVisible?.(t.id === id);
    }
    this._broadcast();
    return id;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      const next = this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/'); // niente tab → nuovo newtab
    }
    this._broadcast();
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    for (const t of this.tabs) {
      t.view.setVisible?.(t.id === id);
    }
    this.layout();
    this._broadcast();
  }

  navigate(id, url) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.view.webContents.loadURL(normalizeUrl(url));
  }

  goBack(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.view.webContents.navigationHistory?.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    } else if (tab.view.webContents.canGoBack?.()) {
      tab.view.webContents.goBack();
    }
  }

  goForward(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.view.webContents.navigationHistory?.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    } else if (tab.view.webContents.canGoForward?.()) {
      tab.view.webContents.goForward();
    }
  }

  reload(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.view.webContents.reload();
  }

  // Nasconde/mostra la view del tab attivo. Serve alla shell per far apparire
  // dropdown HTML (es. menu App) sopra l'area contenuti: le WebContentsView
  // native vengono sempre composte sopra l'HTML della shell e ignorano lo
  // z-index CSS, quindi un menu che sborda nell'area pagina finirebbe coperto.
  setActiveVisible(visible) {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (tab) tab.view.setVisible?.(visible);
  }

  // ─── layout ─────────────────────────────────────────────────────────────

  layout() {
    const [w, h] = this.win.getContentSize();
    for (const tab of this.tabs) {
      if (tab.id === this.activeId) {
        const b = { x: 0, y: this.shellHeight, width: w, height: Math.max(0, h - this.shellHeight) };
        tab.view.setBounds(b);
        if (process.env.FILO_SMOKE) {
          console.log(`[layout] tab ${tab.id.slice(0, 6)} active bounds`, JSON.stringify(b), 'win', w, 'x', h);
        }
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
  }

  // ─── eventi della WebContents → aggiorna stato + broadcast ─────────────

  _wireEvents(tab) {
    const wc = tab.view.webContents;
    const update = (patch) => {
      Object.assign(tab, patch);
      this._broadcast();
    };
    // Debug helper: in dev relay i log della pagina al main.
    if (process.env.NODE_ENV !== 'production') {
      wc.on('console-message', (_e, level, message, line, source) => {
        const tag = ['log', 'warn', 'error'][level] || 'info';
        const src = source ? ` (${source}:${line})` : '';
        console.log(`[tab:${tab.id.slice(0, 6)}:${tag}] ${message}${src}`);
      });
      wc.on('render-process-gone', (_e, details) => {
        console.error(`[tab:${tab.id.slice(0, 6)}] render-process-gone`, details);
      });
      wc.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`[tab:${tab.id.slice(0, 6)}] did-fail-load`, code, desc, url);
      });
    }
    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => {
      update({
        loading: false,
        url: wc.getURL(),
        canBack: canGoBack(wc),
        canFwd: canGoFwd(wc),
      });
    });
    wc.on('page-title-updated', (_e, title) => update({ title: title || tab.title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons?.[0] || '' }));
    wc.on('did-navigate', (_e, url) => update({ url, canBack: canGoBack(wc), canFwd: canGoFwd(wc) }));
    wc.on('did-navigate-in-page', (_e, url) => update({ url, canBack: canGoBack(wc), canFwd: canGoFwd(wc) }));

    // Apertura nuove tab: tutto resta dentro Filo come nuovo tab.
    wc.setWindowOpenHandler(({ url }) => {
      this.openTab(url, { activate: true });
      return { action: 'deny' };
    });
  }

  // ─── snapshot stato per la shell ────────────────────────────────────────

  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        loading: t.loading,
        canBack: t.canBack,
        canFwd: t.canFwd,
        isInternal: t.isInternal,
      })),
    };
  }

  _broadcast() {
    // La shell è il primary webContents della BrowserWindow.
    try {
      this.win.webContents.send('tabs:updated', this.snapshot());
    } catch (_) { /* shell non ancora caricata */ }
  }
}

function canGoBack(wc) {
  if (wc.navigationHistory?.canGoBack) return wc.navigationHistory.canGoBack();
  if (typeof wc.canGoBack === 'function') return wc.canGoBack();
  return false;
}

function canGoFwd(wc) {
  if (wc.navigationHistory?.canGoForward) return wc.navigationHistory.canGoForward();
  if (typeof wc.canGoForward === 'function') return wc.canGoForward();
  return false;
}

// Trasforma input dell'utente in un URL navigabile:
//   - se sembra URL (ha schema o "." al centro) → naviga
//   - altrimenti → google search
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'filo://newtab/';
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('filo://')) return raw;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(raw)) return 'https://' + raw;
  return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
}

module.exports = { TabManager, normalizeUrl };
