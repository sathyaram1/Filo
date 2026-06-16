// #146.1 — Token estetici centralizzati.
//
// Verifica il criterio di fatto della spec: impostando un override via
// storage (settings.themeTokens) l'aspetto cambia OVUNQUE — shell, pagina
// filo:// e superfici Filo su pagina web esterna — SENZA riavvio; rimuovendo
// l'override si torna al predefinito; cambiare il token di categoria cambia
// tutti i token che ne ereditano, e l'override specifico vince.

import { test, expect } from './fixtures/electron.mjs';

const ACCENT_DEFAULT = '#c45a3b';

// Computed value di una variabile CSS sul <html> della pagina.
const cssVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// Applica gli override passando dal percorso reale delle impostazioni
// (UPDATE_SETTINGS → storage → broadcast SETTINGS_UPDATED).
const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);

test('override di un token cambia shell e pagina filo:// live, e il reset ripristina', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  expect(await cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);

  // Marker per provare che non c'è stato alcun reload della pagina.
  await page.evaluate(() => { window.__snNoReload = true; });

  await setTokens(shell, { accent: '#1e90ff' });

  // Pagina filo://: variabile + tripletta rgb derivata, senza reload.
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe('#1e90ff');
  expect(await cssVar(page, '--sn-accent-rgb')).toBe('30, 144, 255');
  expect(await page.evaluate(() => window.__snNoReload)).toBe(true);

  // Shell: la variabile gemella --accent segue lo stesso override.
  await expect.poll(() => cssVar(shell, '--accent')).toBe('#1e90ff');

  // Reset: si torna ai predefiniti ovunque.
  await setTokens(shell, {});
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);
  await expect.poll(() => cssVar(shell, '--accent')).toBe(ACCENT_DEFAULT);
});

test('il token di categoria si propaga a chi ne eredita; lo specifico vince', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');

  // button.bg eredita dalla categoria `text` (i bottoni primari sono testo-su-sfondo).
  await setTokens(shell, { text: '#004488' });
  await expect.poll(() => cssVar(page, '--sn-fg')).toBe('#004488');
  expect(await cssVar(page, '--sn-btn-bg')).toBe('#004488');

  // link.color e selection.color ereditano da `accent`.
  await setTokens(shell, { accent: '#00aa00' });
  await expect.poll(() => cssVar(page, '--sn-link')).toBe('#00aa00');
  expect(await cssVar(page, '--sn-selection-color')).toBe('#00aa00');

  // Override specifico: vince sull'eredità di categoria, che resta per gli altri.
  await setTokens(shell, { accent: '#00aa00', 'link.color': '#ff00ff' });
  await expect.poll(() => cssVar(page, '--sn-link')).toBe('#ff00ff');
  expect(await cssVar(page, '--sn-selection-color')).toBe('#00aa00');
});

test('le superfici Filo su pagina web esterna seguono i token (boot e live)', async ({ shell, openTab, testServer }) => {
  // Override impostato PRIMA di aprire la pagina: testa il percorso di boot
  // del content script (init → applyThemeTokens).
  await setTokens(shell, { accent: '#1e90ff' });

  const page = await testServer.openReady(openTab, '<h1>pagina esterna</h1><p>testo</p>');
  // content.js imposta data-sn-theme, theme.css iniettato definisce --sn-accent,
  // lo style degli override (DOM condiviso col mondo isolato) lo sovrascrive.
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe('#1e90ff');
  expect(await page.evaluate(() => !!document.getElementById('sn-theme-tokens'))).toBe(true);

  // Cambio live a pagina aperta: testa il percorso broadcast SETTINGS_UPDATED.
  await setTokens(shell, { accent: '#aa2200' });
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe('#aa2200');

  // Reset → torna al predefinito anche qui.
  await setTokens(shell, {});
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);
});

test('topbar (#184): colora la barra in alto della shell senza toccare le pagine', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');

  const GREEN = '#1f3d2b';
  const pageBgBefore = await cssVar(page, '--sn-bg');

  await setTokens(shell, { topbar: GREEN });

  // La fascia in alto (--bg-deep) e le tab inattive (--tab-bg) diventano verdi,
  // live e senza riavvio: è ciò che il feedback chiedeva ("colore della barra").
  await expect.poll(() => cssVar(shell, '--bg-deep')).toBe(GREEN);
  await expect.poll(() => cssVar(shell, '--tab-bg')).toBe(GREEN);

  // Ma le superfici di pagina restano intatte: topbar è di sola shell.
  expect(await cssVar(page, '--sn-bg')).toBe(pageBgBefore);

  // Reset: la barra torna al suo neutro (non più verde) ovunque.
  await setTokens(shell, {});
  await expect.poll(() => cssVar(shell, '--bg-deep')).not.toBe(GREEN);
  await expect.poll(() => cssVar(shell, '--tab-bg')).not.toBe(GREEN);
});

test('hover/overlay (#184): superfici di sola pagina (menu, popup) colorabili live', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');

  // Default: hover #ffffff (chiaro), overlay translucido. Override a colori netti.
  const HOVER = '#3a7d44';
  const OVERLAY = '#101820';
  await setTokens(shell, { hover: HOVER, overlay: OVERLAY });

  // Le superfici di pagina (hover di menu/righe, sfondo di popup/sidebar)
  // seguono l'override live, senza riavvio.
  await expect.poll(() => cssVar(page, '--sn-hover')).toBe(HOVER);
  await expect.poll(() => cssVar(page, '--sn-overlay-bg')).toBe(OVERLAY);

  // Sono di sola pagina: la shell non ha variabili gemelle da cambiare.
  expect(await cssVar(shell, '--sn-hover')).toBe('');
  expect(await cssVar(shell, '--sn-overlay-bg')).toBe('');

  // Reset: tornano ai predefiniti del tema.
  await setTokens(shell, {});
  await expect.poll(() => cssVar(page, '--sn-hover')).not.toBe(HOVER);
  await expect.poll(() => cssVar(page, '--sn-overlay-bg')).not.toBe(OVERLAY);
});

test('i valori ostili vengono rifiutati alla scrittura (anti CSS-injection)', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');

  const r = await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { themeTokens: { accent: '#fff; background: url(http://evil)', radius: '12px' } },
  }));
  // Il choke point (applySettingsUpdate) tiene solo i valori in whitelist.
  expect(r.settings.themeTokens).toEqual({ radius: '12px' });

  await expect.poll(() => cssVar(page, '--sn-radius')).toBe('12px');
  expect(await cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);

  await setTokens(shell, {});
});
