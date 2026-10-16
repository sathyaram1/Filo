// Il mondo isolato di Filo con una CSP propria: Chromium allora non gli applica quella della pagina (Trusted Types
// compreso), come ai content script delle estensioni (#1122). Electron la azzera a ogni documento nuovo del processo
// senza sempre rifare il preload: chi scrive HTML da stringa la riafferma. Prova: tests/context-menu-trusted-types.spec.mjs

const MONDO = 999;
const CSP = "object-src 'none'";

module.exports = function mondoEsente(webFrame, finestra = globalThis) {
  const esenta = () => {
    try {
      webFrame.setIsolatedWorldInfo(MONDO, { securityOrigin: finestra.origin, csp: CSP, name: 'Electron Isolated Context' });
    } catch (_) {}
  };
  esenta();
  const prima = (fn) => function (...args) { esenta(); return fn.apply(this, args); };
  const accessori = [['Element', 'innerHTML'], ['Element', 'outerHTML'], ['ShadowRoot', 'innerHTML'], ['HTMLIFrameElement', 'srcdoc']];
  for (const [classe, nome] of accessori) {
    try {
      const proto = finestra[classe].prototype;
      const d = Object.getOwnPropertyDescriptor(proto, nome);
      if (d && d.set) Object.defineProperty(proto, nome, { ...d, set: prima(d.set) });
    } catch (_) {}
  }
  const metodi = [['Element', 'insertAdjacentHTML'], ['Element', 'setHTMLUnsafe'], ['ShadowRoot', 'setHTMLUnsafe'],
    ['Range', 'createContextualFragment'], ['DOMParser', 'parseFromString'], ['Document', 'write'], ['Document', 'writeln']];
  for (const [classe, nome] of metodi) {
    try {
      const proto = finestra[classe].prototype;
      if (typeof proto[nome] === 'function') proto[nome] = prima(proto[nome]);
    } catch (_) {}
  }
  try {
    if (typeof finestra.Document.parseHTMLUnsafe === 'function') finestra.Document.parseHTMLUnsafe = prima(finestra.Document.parseHTMLUnsafe);
  } catch (_) {}
  return esenta;
};
