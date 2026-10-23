// Diagnosi dell'accesso Google respinto in un profilo nuovo (#1616): interruttori dall'ambiente, FILO_DIAG_GOOGLE =
// elenco separato da virgole fra gpc (niente Sec-GPC né navigator.globalPrivacyControl), brands (client hints da Chrome),
// hints (gli stessi header, marchio onesto «Chromium»), chrome (window.chrome finto) e cond (richiesta passkey
// condizionale lasciata in sospeso come in Chrome).

'use strict';

const FLAGS = new Set(String(process.env.FILO_DIAG_GOOGLE || '').split(',').map((s) => s.trim()).filter(Boolean));

function ha(flag) { return FLAGS.has(flag); }

// gpcauth: GPC spento solo sulle superfici di accesso dei provider noti (stessa lista dell'esenzione anti-fingerprint).
function hostIdentita(href) {
  try {
    require('../../shared/authPopup');
    const A = globalThis.SN_AUTH_POPUP;
    return !!(A && typeof A.isIdentityAuthSurface === 'function' && A.isIdentityAuthSurface(String(href || '')));
  } catch (_) { return false; }
}
function gpcSpento(href) { return ha('gpc') || (ha('gpcauth') && hostIdentita(href)); }
function elenco() { return [...FLAGS]; }

// La versione di Chromium è quella vera: cambia solo il marchio, come fa Chrome.
function versioneChromium() { return String(process.versions.chrome || '0.0.0.0'); }

// Chrome manda sempre i tre hint a bassa entropia; Electron con la UA riscritta non ne manda nessuno. Si aggiungono
// se mancano e si riscrivono se ci sono, col marchio «Google Chrome» accanto a «Chromium».
function piattaforma() {
  return process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
}
function marchiChrome(headers, conChrome = true) {
  const piena = versioneChromium();
  const maggiore = piena.split('.')[0];
  const google = conChrome ? ', "Google Chrome";v="' + maggiore + '"' : '';
  const googlePieno = conChrome ? ', "Google Chrome";v="' + piena + '"' : '';
  const out = { ...headers };
  const chiavi = Object.keys(out);
  const trova = (nome) => chiavi.find((k) => k.toLowerCase() === nome) || null;
  const metti = (nome, valore, soloSePresente) => {
    const k = trova(nome.toLowerCase());
    if (k) out[k] = valore;
    else if (!soloSePresente) out[nome] = valore;
  };
  metti('Sec-CH-UA', `"Not?A_Brand";v="24", "Chromium";v="${maggiore}"${google}`, false);
  metti('Sec-CH-UA-Mobile', '?0', false);
  metti('Sec-CH-UA-Platform', `"${piattaforma()}"`, false);
  metti('Sec-CH-UA-Full-Version-List', `"Not?A_Brand";v="24.0.0.0", "Chromium";v="${piena}"${googlePieno}`, true);
  return out;
}

module.exports = { ha, elenco, marchiChrome, versioneChromium, hostIdentita, gpcSpento };
