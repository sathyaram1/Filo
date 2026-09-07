// Leggibilità e continuità della striscia delle schede (#429, secondo giro).
//
// Quattro cose che la barra deve garantire, tutte misurate da fuori come le
// vedrebbe l'utente. Ognuna era rotta prima di questo spec:
//   1. il NOME di una scheda si legge su qualsiasi tinta, anche al buio;
//   2. sotto una certa larghezza la crocetta invisibile non ruba spazio al nome;
//   3. la scheda in primo piano continua a seguire la pagina anche quando è la
//      pagina a cambiare colore da sola (nessuno scroll, nessun ridimensionamento);
//   4. i piedini della scheda in primo piano stanno dentro la striscia, che con
//      due schede non si dichiara scrollabile.

import { test, expect } from './fixtures/electron.mjs';

const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (m) return m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
  const c = /color\(\s*srgb\s+([^)]+)\)/.exec(s || '');
  if (c) return c[1].trim().split(/[\s/]+/).slice(0, 3).map((v) => Math.round(parseFloat(v) * 255));
  return null;
};
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrasto = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const SCHEDE = () => [...document.querySelectorAll('.tab')].map((el) => {
  const t = el.querySelector('.title');
  const c = el.querySelector('.close');
  const r = el.getBoundingClientRect();
  return {
    text: t ? t.textContent : '',
    active: el.classList.contains('active'),
    w: Math.round(r.width),
    titleW: t ? Math.round(t.getBoundingClientRect().width) : 0,
    closeW: c ? Math.round(c.getBoundingClientRect().width) : 0,
    fondo: getComputedStyle(el).backgroundColor,
    testo: getComputedStyle(t || el).color,
  };
});

test('al buio il nome delle schede in secondo piano si legge', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  // Un sito dal marchio CHIARO (Wikipedia, GitHub, X, e tutte le pagine di
  // Filo): è il caso che rendeva la scheda un rettangolo grigio chiaro col nome
  // scritto nel grigio caldo del tema scuro, 1,08 a 1.
  const fav = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
    + '<rect width="16" height="16" fill="rgb(240,240,240)"/></svg>',
  );
  await shell.evaluate(
    (u) => window.filoShell.tabs.open(u),
    testServer.html(`<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}">`
      + '<title>Enciclopedia libera</title></head><body style="margin:0;background:#fff">testo</body></html>'),
  );
  await shell.waitForTimeout(1500);
  await shell.evaluate(
    (u) => window.filoShell.tabs.open(u),
    testServer.html('<title>In primo piano</title><body style="margin:0;background:rgb(20,20,20)">y</body>'),
  );

  // La tinta del marchio arriva dopo (favicon → main → broadcast): aspettiamo
  // che la scheda in secondo piano sia DAVVERO tinta, altrimenti il test
  // passerebbe anche col difetto.
  await expect.poll(async () => shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find(
      (t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'),
    );
    return el ? el.style.getPropertyValue('--tab-bg-eff') : null;
  }), { timeout: 10_000 }).toMatch(/rgb/);

  const schede = await shell.evaluate(SCHEDE);
  for (const s of schede.filter((x) => !x.active)) {
    const c = contrasto(rgb(s.fondo), rgb(s.testo));
    expect(c, `"${s.text}": nome ${s.testo} su fondo ${s.fondo}`).toBeGreaterThanOrEqual(4);
  }
});

test('con molte schede la crocetta invisibile non ruba spazio al nome', async ({ shell, testServer }) => {
  const nomi = ['Meteo Italia oggi', 'Mercati e finanza', 'Musica classica', 'Mappe e percorsi',
    'Manuale utente', 'Messaggi', 'Marketplace', 'Modelli 3D', 'Motori di ricerca', 'Mostra'];
  for (const n of nomi) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length),
    { timeout: 15_000 }).toBe(nomi.length + 1);
  await shell.waitForTimeout(600);

  const schede = await shell.evaluate(SCHEDE);
  const strette = schede.filter((s) => !s.active && s.w < 160);
  // Pre-condizione: con 11 schede su una finestra normale le schede SONO strette.
  expect(strette.length, 'con 11 schede la barra si stringe davvero').toBeGreaterThan(0);
  for (const s of strette) {
    expect(s.closeW, `"${s.text}" (larga ${s.w}px) tiene ancora spazio per una crocetta che non disegna`).toBe(0);
    // Lo spazio recuperato va al nome: la casella del titolo supera i 40px, cioè
    // qualche lettera in più di "Me…".
    expect(s.titleW, `"${s.text}": casella del nome larga ${s.titleW}px`).toBeGreaterThan(40);
  }
});

test('la scheda in primo piano segue la pagina che cambia colore da sola', async ({ shell, app, testServer }) => {
  // Nessuno scroll, nessun ridimensionamento: la pagina si colora dopo, come
  // fa un sito che accende il suo tema scuro o che monta l'intestazione tardi.
  const url = testServer.html(`
    <title>Cambia colore</title>
    <body style="margin:0;background:#ffffff">
      <div id="t" style="height:80px;background:#ffffff"></div>
      <div style="height:2000px"></div>
    </body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const pagina = await expect.poll(() => {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return p ? 'c\'è' : null;
  }, { timeout: 12_000 }).toBe('c\'è').then(() => app.windows().find((w) => w.url() === url));

  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 10_000 }).toBe('rgb(255, 255, 255)');

  // Oltre i campionamenti di cortesia del caricamento (l'ultimo a 1,2s): il
  // cambio deve essere raccolto perché la pagina è cambiata, non perché è
  // appena stata aperta. Senza questa attesa il test passerebbe anche col
  // difetto.
  await shell.waitForTimeout(2500);
  await pagina.evaluate(() => { document.getElementById('t').style.background = 'rgb(180, 20, 140)'; });

  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 10_000, message: 'la scheda è rimasta del colore vecchio' }).toBe('rgb(180, 20, 140)');
});

test('i piedini della scheda in primo piano stanno dentro la striscia', async ({ shell }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length),
    { timeout: 10_000 }).toBe(2);
  await shell.waitForTimeout(500);

  const m = await shell.evaluate(() => {
    const strip = document.querySelector('.tabs');
    const attiva = document.querySelector('.tab.active');
    const r = attiva.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    strip.scrollLeft = 9999;
    const scorsa = strip.scrollLeft;
    strip.scrollLeft = 0;
    return {
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
      scorsa,
      // gli 8px di piedino a destra e a sinistra della scheda in primo piano
      spazioDestra: Math.round(s.right - r.right),
      spazioSinistra: Math.round(r.left - s.left),
    };
  });
  expect(m.scrollWidth, 'con due schede la striscia non deve essere scrollabile').toBeLessThanOrEqual(m.clientWidth);
  expect(m.scorsa, 'la rotella non deve poter far scivolare la fila').toBe(0);
  expect(m.spazioDestra, 'il piedino destro non ci sta').toBeGreaterThanOrEqual(8);
});
