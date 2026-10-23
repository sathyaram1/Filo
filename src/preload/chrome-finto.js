// Diagnosi dell'accesso Google (#1609), mondo della pagina: `window.chrome` come in Chrome e client hints col marchio
// «Google Chrome», con le funzioni mascherate da native. Acceso solo dagli interruttori di services/diagGoogle.js.

function buildSource({ chrome = false, brands = false, versione = '0.0.0.0' } = {}) {
  const maggiore = String(versione).split('.')[0];
  return `(function(){
  'use strict';
  try {
    var FP = Function.prototype, prev = FP.toString, originali = new WeakMap();
    function toString() { var o = originali.get(this); return prev.apply(o || this, arguments); }
    originali.set(toString, prev);
    FP.toString = toString;
    function nativa(fn, nome) {
      try { Object.defineProperty(fn, 'name', { value: nome, configurable: true }); } catch (e) {}
      originali.set(fn, Function.prototype.call.bind(Function.prototype.call) && (function(){}).bind());
      return fn;
    }
    if (${chrome ? 'true' : 'false'} && !window.chrome) {
      var chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: nativa(function getDetails() { return null; }, 'getDetails'),
          getIsInstalled: nativa(function getIsInstalled() { return false; }, 'getIsInstalled'),
          runningState: nativa(function runningState() { return 'cannot_run'; }, 'runningState')
        },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          connect: nativa(function connect() { throw new TypeError('Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument.'); }, 'connect'),
          sendMessage: nativa(function sendMessage() { throw new TypeError('Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function callback): chrome.runtime.sendMessage() called from a webpage must specify an Extension ID (string) for its first argument.'); }, 'sendMessage')
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
      Object.defineProperty(window, 'chrome', { value: chrome, writable: true, enumerable: true, configurable: false });
    }
    if (${brands ? 'true' : 'false'} && navigator.userAgentData && window.NavigatorUAData) {
      var P = NavigatorUAData.prototype;
      var marchi = [{ brand: 'Not?A_Brand', version: '24' }, { brand: 'Chromium', version: '${maggiore}' }, { brand: 'Google Chrome', version: '${maggiore}' }];
      var pieni = [{ brand: 'Not?A_Brand', version: '24.0.0.0' }, { brand: 'Chromium', version: '${versione}' }, { brand: 'Google Chrome', version: '${versione}' }];
      var dBrands = Object.getOwnPropertyDescriptor(P, 'brands');
      if (dBrands && dBrands.get) {
        var gB = function brands() { return marchi.map(function (b) { return { brand: b.brand, version: b.version }; }); };
        originali.set(gB, dBrands.get);
        Object.defineProperty(P, 'brands', { get: gB, enumerable: true, configurable: true });
      }
      var oHigh = P.getHighEntropyValues;
      if (typeof oHigh === 'function') {
        var gH = function getHighEntropyValues(hints) {
          return oHigh.call(this, hints).then(function (v) {
            if (v && v.brands) v.brands = marchi.slice();
            if (v && v.fullVersionList) v.fullVersionList = pieni.slice();
            return v;
          });
        };
        try { Object.defineProperty(gH, 'length', { value: 1, configurable: true }); } catch (e) {}
        originali.set(gH, oHigh);
        P.getHighEntropyValues = gH;
      }
      var oJson = P.toJSON;
      if (typeof oJson === 'function') {
        var gJ = function toJSON() { var v = oJson.call(this); if (v) v.brands = marchi.slice(); return v; };
        originali.set(gJ, oJson);
        P.toJSON = gJ;
      }
    }
  } catch (e) { try { console.log('[Filo diag google] non installata ' + e); } catch (_) {} }
})();`;
}

module.exports = { buildSource };
