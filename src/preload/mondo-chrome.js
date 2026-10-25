// Il mondo della pagina come in Chrome, iniettato dal page-preload in ogni frame http(s) prima degli script del sito:
// window.chrome pieno, richiesta passkey condizionale in sospeso, passkey del telefono raggiungibile dal QR. Senza,
// Google respinge l'accesso in un profilo nuovo (#1616) e il telefono non trova la passkey (#1608).

'use strict';

function buildSource() {
  return `(function(){
  'use strict';
  try {
    var FP = Function.prototype, prev = FP.toString, originali = new WeakMap();
    // Google respinge un browser con le API ritoccate: ogni funzione di Filo si presenta come quella nativa, e la
    // catena di toString regge le altre maschere di Filo (menu-del-sito.js), prima o dopo di questa.
    // Metodi, non funzioni: le native non hanno «prototype» e non si costruiscono, e la pagina lo controlla.
    // Una funzione di un altro riquadro la racconta il toString del suo riquadro (regola gemella in riquadri-vuoti.js).
    var toString = ({ toString() {
      var o = originali.get(this); if (typeof o === 'string') return o;
      if (!o && typeof this === 'function') {
        try { var casa = Object.getPrototypeOf(this); if (typeof casa === 'function' && casa !== FP && casa.toString !== toString) return casa.toString.call(this); } catch (e) {}
      }
      return prev.apply(o || this, arguments);
    } }).toString;
    originali.set(toString, prev);
    FP.toString = toString;
    function nativa(fn, nome, orig) {
      var m = fn;
      try {
        m = ({ [nome]() { return fn.apply(this, arguments); } })[nome];
        Object.defineProperty(m, 'length', { value: orig ? orig.length : 0, configurable: true });
      } catch (e) {}
      originali.set(m, orig || ('function ' + nome + '() { [native code] }'));
      return m;
    }
    function evento() {
      return {
        addListener: nativa(function addListener() {}, 'addListener'),
        removeListener: nativa(function removeListener() {}, 'removeListener'),
        hasListener: nativa(function hasListener() { return false; }, 'hasListener'),
        hasListeners: nativa(function hasListeners() { return false; }, 'hasListeners')
      };
    }
    // Nessuna estensione risponde mai: la porta si chiude da sola, dopo, come in Chrome.
    function porta(info) {
      var chiusa = { addListener: nativa(function addListener(fn) { if (typeof fn === 'function') setTimeout(function () { fn(p); }, 0); }, 'addListener'),
        removeListener: nativa(function removeListener() {}, 'removeListener'),
        hasListener: nativa(function hasListener() { return false; }, 'hasListener'),
        hasListeners: nativa(function hasListeners() { return false; }, 'hasListeners') };
      var p = { name: (info && typeof info.name === 'string') ? info.name : '', onMessage: evento(), onDisconnect: chiusa,
        postMessage: nativa(function postMessage() {}, 'postMessage'), disconnect: nativa(function disconnect() {}, 'disconnect') };
      return p;
    }
    var SENZA_ID = ' called from a webpage must specify an Extension ID (string) for its first argument.';
    // Electron, come Chrome headless, ha un window.chrome vuoto: si riempie quello, non se ne crea un altro.
    if (!(window.chrome && window.chrome.runtime)) {
      var base = (window.chrome && typeof window.chrome === 'object') ? window.chrome : null;
      var chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: nativa(function getDetails() { return null; }, 'getDetails'),
          getIsInstalled: nativa(function getIsInstalled() { return false; }, 'getIsInstalled'),
          installState: nativa(function installState(cb) { if (typeof cb === 'function') setTimeout(function () { cb('not_installed'); }, 0); }, 'installState'),
          runningState: nativa(function runningState() { return 'cannot_run'; }, 'runningState')
        },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          connect: nativa(function connect(id, info) {
            if (typeof id !== 'string') throw new TypeError('Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): chrome.runtime.connect()' + SENZA_ID);
            return porta(info);
          }, 'connect'),
          sendMessage: nativa(function sendMessage(id) {
            if (typeof id !== 'string') throw new TypeError('Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function callback): chrome.runtime.sendMessage()' + SENZA_ID);
            var cb = arguments[arguments.length - 1];
            if (arguments.length > 1 && typeof cb === 'function') setTimeout(function () { cb(undefined); }, 0);
          }, 'sendMessage')
        },
        csi: nativa(function csi() { var t = performance.timing; return { onloadT: t.domContentLoadedEventEnd, pageT: performance.now(), startE: t.navigationStart, tran: 15 }; }, 'csi'),
        loadTimes: nativa(function loadTimes() {
          var t = performance.timing, nav = performance.getEntriesByType('navigation')[0] || {};
          return { commitLoadTime: t.responseStart / 1000, connectionInfo: nav.nextHopProtocol || 'h2', finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000,
            finishLoadTime: t.loadEventEnd / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: t.responseStart / 1000, navigationType: 'Other',
            npnNegotiatedProtocol: nav.nextHopProtocol || 'h2', requestTime: t.navigationStart / 1000, startLoadTime: t.navigationStart / 1000,
            wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true };
        }, 'loadTimes')
      };
      if (base) { for (var k in chrome) { try { Object.defineProperty(base, k, { value: chrome[k], writable: true, enumerable: true, configurable: true }); } catch (e) {} } }
      else Object.defineProperty(window, 'chrome', { value: chrome, writable: true, enumerable: true, configurable: true });
    }
    var CC = typeof CredentialsContainer === 'function' && CredentialsContainer.prototype;
    var dGet = CC && Object.getOwnPropertyDescriptor(CC, 'get');
    if (dGet && typeof dGet.value === 'function') {
      var oGet = dGet.value;
      // Chrome tiene in sospeso la richiesta condizionale finché l'utente non sceglie dall'autocompilazione delle
      // passkey; Electron, che non ce l'ha, la respinge subito e il sito chiede la passkey invece della password.
      function inSospeso(opts) {
        return new Promise(function (_, rej) {
          var sig = opts.signal;
          if (!sig || typeof sig.addEventListener !== 'function') return;
          var abort = function () { rej(sig.reason !== undefined ? sig.reason : new DOMException('The operation was aborted.', 'AbortError')); };
          if (sig.aborted) abort(); else sig.addEventListener('abort', abort, { once: true });
        });
      }
      function permessa() {
        try {
          var pp = document.permissionsPolicy || document.featurePolicy;
          return !pp || typeof pp.allowsFeature !== 'function' || pp.allowsFeature('publickey-credentials-get');
        } catch (e) { return true; }
      }
      // Su Windows il flusso col telefono scarta le credenziali «internal», che Chromium tratta come raggiungibili via
      // hybrid: si completa una COPIA delle opzioni, l'oggetto della pagina non si tocca.
      function conHybrid(opts) {
        var pk = opts.publicKey, lista = pk.allowCredentials, cambiate = 0;
        if (!Array.isArray(lista)) return opts;
        var nuova = lista.map(function (c) {
          var t = c && c.transports;
          if (!Array.isArray(t) || t.indexOf('internal') < 0 || t.indexOf('hybrid') >= 0 || t.indexOf('cable') >= 0) return c;
          cambiate++;
          return Object.assign({}, c, { transports: t.concat(['hybrid']) });
        });
        return cambiate ? Object.assign({}, opts, { publicKey: Object.assign({}, pk, { allowCredentials: nuova }) }) : opts;
      }
      var get = function get(opts) {
        var args = Array.prototype.slice.call(arguments);
        if (opts && typeof opts === 'object' && opts.publicKey && typeof opts.publicKey === 'object') {
          if (opts.mediation === 'conditional' && permessa()) return inSospeso(opts);
          try { args[0] = conHybrid(opts); } catch (e) {}
        }
        return oGet.apply(this, args);
      };
      get = nativa(get, 'get', oGet);
      Object.defineProperty(CC, 'get', { value: get, writable: dGet.writable, enumerable: dGet.enumerable, configurable: true });
    }
  } catch (e) {}
})();`;
}

module.exports = { buildSource };
