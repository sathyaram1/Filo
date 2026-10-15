// Il token `motion` visto dal main: i tempi che aspettano un'animazione CSS (chiusura della barra laterale,
// menu a comparsa) si allungano e si accorciano con lei. Lo aggiornano l'avvio e applySettingsUpdate.

let fattore = 1;

function segui(settings) {
  const T = globalThis.SN_THEME_TOKENS;
  const v = T && T.effectiveValue ? Number(T.effectiveValue('motion', (settings && settings.themeTokens) || {}, 'light')) : 1;
  fattore = Number.isFinite(v) ? Math.min(T.FACTOR_MAX || 3, Math.max(0, v)) : 1;
}

function ms(n) {
  return Math.round(Number(n) * fattore) || 0;
}

// Le variabili da passare alle viste che non leggono le impostazioni da sé.
function variabili(settings) {
  const T = globalThis.SN_THEME_TOKENS;
  const over = (settings && settings.themeTokens) || {};
  return {
    '--sn-motion': String(fattore),
    '--sn-shadow-opacity': T && T.effectiveValue ? T.effectiveValue('shadow', over, 'light') : '0.18',
  };
}

module.exports = { segui, ms, fattore: () => fattore, variabili };
