// I token `motion`, `shadow` e i colori del fumetto visti dal main, per le viste che non leggono le impostazioni da sé
// (il menu a comparsa, il fumetto della barra) e per i tempi che aspettano un'animazione CSS. Li aggiornano l'avvio e
// applySettingsUpdate.

let fattore = 1;
let ombra = '0.18';
let override = {};

function segui(settings) {
  const T = globalThis.SN_THEME_TOKENS;
  if (!T || !T.effectiveValue) return;
  const over = (settings && settings.themeTokens) || {};
  override = T.sanitize ? T.sanitize(over).clean : {};
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

// I colori del fumetto della barra per il tema in vigore: gli stessi token del fumetto nelle pagine (#2095).
function fumetto(scuro) {
  const T = globalThis.SN_THEME_TOKENS;
  if (!T || !T.effectiveValue) return {};
  const tema = scuro ? 'dark' : 'light';
  return {
    '--bg': T.effectiveValue('fumetto.sfondo', override, tema),
    '--fg': T.effectiveValue('fumetto.testo', override, tema),
    '--border': T.effectiveValue('fumetto.bordo', override, tema),
    '--sn-shadow-opacity': ombra,
  };
}

module.exports = { segui, ms, fattore: () => fattore, variabili, fumetto };
