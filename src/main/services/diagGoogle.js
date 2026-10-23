// Diagnosi dell'accesso Google respinto in un profilo nuovo (#1609): interruttori dall'ambiente, FILO_DIAG_GOOGLE =
// elenco separato da virgole fra gpc (niente Sec-GPC né navigator.globalPrivacyControl), brands (client hints da Chrome),
// chrome (window.chrome finto) e cond (richiesta passkey condizionale lasciata in sospeso come in Chrome).

'use strict';

const FLAGS = new Set(String(process.env.FILO_DIAG_GOOGLE || '').split(',').map((s) => s.trim()).filter(Boolean));

function ha(flag) { return FLAGS.has(flag); }
function elenco() { return [...FLAGS]; }

// La versione di Chromium è quella vera: cambia solo il marchio, come fa Chrome.
function versioneChromium() { return String(process.versions.chrome || '0.0.0.0'); }

function marchiChrome(headers) {
  const piena = versioneChromium();
  const maggiore = piena.split('.')[0];
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    const kl = k.toLowerCase();
    if (kl === 'sec-ch-ua') out[k] = `"Not?A_Brand";v="24", "Chromium";v="${maggiore}", "Google Chrome";v="${maggiore}"`;
    else if (kl === 'sec-ch-ua-full-version-list') out[k] = `"Not?A_Brand";v="24.0.0.0", "Chromium";v="${piena}", "Google Chrome";v="${piena}"`;
  }
  return out;
}

module.exports = { ha, elenco, marchiChrome, versioneChromium };
