// #837 giro 1 — esplorazione del verificatore: a velocità 0 nessuna durata resta accesa sulle pagine di Filo.
import { test, expect } from '../../fixtures/electron.mjs';

const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);
const azione = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), { type: 'IMPOSTA_ESTETICA', ...a });
const tokensSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});

// Elenca gli elementi (anche ::before/::after e dentro shadow root) con una durata > 0.
const accesi = (page) => page.evaluate(() => {
  const ms = (s) => String(s || '').split(',').map((x) => { x = x.trim(); return x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000; });
  const out = [];
  const guarda = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    const t = Math.max(...ms(cs.transitionDuration));
    const a = cs.animationName !== 'none' ? Math.max(...ms(cs.animationDuration)) : 0;
    if (t > 0 || a > 0) {
      const id = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      out.push(`${id}${pseudo || ''} t=${cs.transitionDuration} a=${cs.animationName}:${cs.animationDuration}`);
    }
  };
  const giro = (root) => {
    for (const el of root.querySelectorAll('*')) {
      guarda(el, null); guarda(el, '::before'); guarda(el, '::after');
      if (el.shadowRoot) giro(el.shadowRoot);
    }
  };
  giro(document);
  return out;
});

const PAGINE = [
  'filo://preferences/preferences.html', 'filo://manage/manage.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://board/board.html', 'filo://editor/editor.html',
  'filo://downloads/downloads.html', 'filo://archive/archive.html', 'filo://transparency/transparency.html',
  'filo://decks/decks.html', 'filo://credits/credits.html', 'filo://security/security.html',
];

test('velocità 0: nessuna durata accesa nelle pagine di Filo, nella home e nella shell', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const r = await azione(app, { token: 'motion', valore: '0' });
  expect(r && r.executed).toBe(true);
  const rapporto = {};
  rapporto.shell = await accesi(shell);
  for (const u of PAGINE) {
    const p = await openTab(u);
    await p.waitForTimeout(800);
    rapporto[u] = await accesi(p);
  }
  const home = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  if (home) rapporto.home = await accesi(home);
  console.log(JSON.stringify(rapporto, null, 1));
  const tutti = Object.values(rapporto).flat();
  expect(tutti).toEqual([]);
});

test('font dei link: data-sn-pagina e il link prende il font su ogni pagina; senza ritocco segue la UI', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await setTokens(shell, { 'link.font': 'Georgia, serif' });
  const esiti = {};
  for (const u of [...PAGINE, 'filo://newtab/']) {
    let p;
    if (u === 'filo://newtab/') p = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    else p = await openTab(u);
    if (!p) continue;
    await p.waitForTimeout(400);
    esiti[u] = await p.evaluate(() => {
      const a = document.createElement('a'); a.href = '#'; a.textContent = 'x';
      const q = document.createElement('p'); q.textContent = 'y';
      document.body.append(a, q);
      const r = { link: getComputedStyle(a).fontFamily, testo: getComputedStyle(q).fontFamily,
        reali: [...document.querySelectorAll('a')].slice(0, 5).map((x) => getComputedStyle(x).fontFamily) };
      a.remove(); q.remove();
      return r;
    });
  }
  console.log(JSON.stringify(esiti, null, 1));
  for (const [u, e] of Object.entries(esiti)) {
    expect(e.link, u).toContain('Georgia');
    expect(e.testo, u).not.toContain('Georgia');
  }
});

test('chat: il valore arriva come numero (0, 1.5) e viene accettato', async ({ app }) => {
  const a = await azione(app, { token: 'motion', valore: 0 });
  const b = await azione(app, { token: 'motion', valore: 1.5 });
  console.log(JSON.stringify({ a, b, t: await tokensSalvati(app) }));
  expect(a.executed).toBe(true);
  expect(b.executed).toBe(true);
});

test('valori al limite', async ({ app }) => {
  const prove = ['3', '3.0', '3.001', '-1', '1,5', '', '   ', '0.0', '.5', '1e0', 'calc(1)', '2;}', '<b>', '🐌'];
  const out = {};
  for (const v of prove) {
    const r = await azione(app, { token: 'motion', valore: v });
    out[JSON.stringify(v)] = r.executed ? 'ok' : (r.output && r.output.error);
  }
  const sh = {};
  for (const v of ['0', '1', '1.5', '-0.1', '0.5']) {
    const r = await azione(app, { token: 'shadow', valore: v });
    sh[v] = r.executed ? 'ok' : (r.output && r.output.error);
  }
  const lf = {};
  for (const v of ['Georgia, serif', '"Times New Roman", serif', 'a;}body{color:red', '']) {
    const r = await azione(app, { token: 'link.font', valore: v });
    lf[v] = r.executed ? 'ok' : (r.output && r.output.error);
  }
  console.log(JSON.stringify({ out, sh, lf }, null, 1));
});
