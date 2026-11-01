// Il menu a comparsa nelle prove: una finestra «data:text/html». Lo è anche il fumetto dei suggerimenti, che nasce
// all'avvio (#871.4): chi cerca il menu per indirizzo passa da qui, o prende il fumetto (#1722 giro 1).

export const SEGNO_DEL_FUMETTO = 'window.fumetto';

export function eUnMenu(url) {
  const u = String(url || '');
  if (!u.startsWith('data:text/html')) return false;
  try { return !decodeURIComponent(u).includes(SEGNO_DEL_FUMETTO); } catch (_) { return !u.includes('fumetto'); }
}

export const finestreDelMenu = (app) => app.windows().filter((w) => { try { return !w.isClosed() && eUnMenu(w.url()); } catch (_) { return false; } });
