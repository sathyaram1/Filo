// I token `motion` e `shadow` visti dal main, per le viste che non leggono le impostazioni da sé (il menu a
// comparsa) e per i tempi che aspettano un'animazione CSS. Li aggiornano l'avvio e applySettingsUpdate.

let fattore = 1;
let ombra = '0.18';

function segui(settings) {
  const T = globalThis.SN_THEME_TOKENS;
  if (!T || !T.effectiveValue) return;
  const over = (settings && settings.themeTokens) || {};
  const v = Number(T.effectiveValue('motion', over, 'light'));
  fattore = Number.isFinite(v) ? Math.min(T.FACTOR_MAX || 3, Math.max(0, v)) : 1;
  ombra = T.effectiveValue('shadow', over, 'light') || '0.18';
}

function ms(n) {
  return Math.round(Number(n) * fattore) || 0;
}

function variabili() {
  return { '--sn-motion': String(fattore), '--sn-shadow-opacity': ombra };
}

module.exports = { segui, ms, fattore: () => fattore, variabili };
