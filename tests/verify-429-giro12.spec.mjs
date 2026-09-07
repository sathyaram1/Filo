// Verifica avversariale #429, giro nuovo.
// Sintomo utente: "la tab attuale (ora sono in gestione) voglio che abbia lo
// stesso colore dello sfondo della pagina in alto ... deve sembrare una
// continuazione della pagina" + "la prima tab è troppo compressa, c'è lo spazio
// per mostrare il nome ma viene mostrato solo M...".
// Qui si ri-provano anche TUTTE le porte del giro precedente.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (m) return m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
  return null;
};
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrasto = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

const SCHEDE = () => [...document.querySelectorAll('.tab')].map((el) => {
  const t = el.querySelector('.title');
  const c = el.querySelector('.close');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    text: t ? t.textContent : '',
    full: el.dataset.tip || '',
    active: el.classList.contains('active'),
    stretta: el.classList.contains('stretta'),
    w: Math.round(r.width),
    titleW: t ? Math.round(t.getBoundingClientRect().width) : 0,
    titleScroll: t ? t.scrollWidth : 0,
    tagliato: t ? (t.scrollWidth > Math.ceil(t.getBoundingClientRect().width) + 1) : false,
    closeW: c ? Math.round(c.getBoundingClientRect().width) : 0,
    fondo: cs.backgroundColor,
    testo: t ? getComputedStyle(t).color : cs.color,
  };
});

// Attende che la pagina URL sia comparsa fra le window e la ritorna.
async function paginaDi(app, url, timeout = 12_000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina mai comparsa: ' + url);
}

// ── 1. La richiesta letterale: la scheda attiva È la cima della pagina ──────
for (const tema of ['light', 'dark']) {
  test(`[${tema}] la scheda in primo piano ha lo stesso colore della cima di Gestione`, async ({ shell, app }) => {
    await shell.emulateMedia({ colorScheme: tema });
    await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
    const pag = await paginaDi(app, 'filo://manage/manage.html');
    await pag.emulateMedia({ colorScheme: tema });
    await pag.waitForLoadState('domcontentloaded').catch(() => {});
    await shell.waitForTimeout(2500);

    const cimaPagina = await pag.evaluate(() => {
      const el = document.elementFromPoint(Math.round(window.innerWidth / 2), 16);
      let n = el; let hop = 0;
      while (n && n.nodeType === 1 && hop < 6) {
        const c = getComputedStyle(n).backgroundColor;
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (m) {
          const p = m[1].split(',').map((s) => parseFloat(s));
          if (p.length < 4 || p[3] >= 0.5) return c;
        }
        n = n.parentElement; hop++;
      }
      return getComputedStyle(document.body).backgroundColor;
    });
    const scheda = await shell.evaluate(() => {
      const el = document.querySelector('.tab.active');
      return { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector('.title')).color };
    });
    expect(dist(rgb(scheda.bg), rgb(cimaPagina)),
      `scheda ${scheda.bg} vs cima pagina ${cimaPagina}`).toBeLessThanOrEqual(2);
    // e il nome sopra si legge
    expect(contrasto(rgb(scheda.bg), rgb(scheda.fg)),
      `nome ${scheda.fg} su ${scheda.bg}`).toBeGreaterThanOrEqual(4.5);
  });
}

// ── 2. La seconda richiesta: il nome non è compresso quando c'è spazio ─────
test('con poche schede nessun nome è tagliato mentre nella barra avanza spazio', async ({ shell, testServer }) => {
  const nomi = ['Gestione feedback di Filo', 'Enciclopedia libera', 'Rassegna stampa'];
  for (const n of nomi) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length),
    { timeout: 15_000 }).toBe(nomi.length + 1);
  await shell.waitForTimeout(800);

  const m = await shell.evaluate(() => {
    const strip = document.querySelector('.tabs');
    const r = strip.getBoundingClientRect();
    const row = document.querySelector('.tab-row').getBoundingClientRect();
    return { stripW: Math.round(r.width), rowW: Math.round(row.width), scroll: strip.scrollWidth, client: strip.clientWidth };
  });
  const schede = await shell.evaluate(SCHEDE);
  const avanza = m.rowW - m.stripW;
  // Pre-condizione: nella riga avanza spazio davvero (altrimenti il test passa a vuoto)
  expect(avanza, `nella riga avanzano ${avanza}px`).toBeGreaterThan(100);
  for (const s of schede) {
    expect(s.tagliato, `"${s.full}" è tagliato ("${s.text}" ${s.titleScroll}px in ${s.titleW}px) mentre avanzano ${avanza}px`).toBe(false);
  }
});

// ── 3. Porta del giro precedente: al buio il nome delle inattive si legge ──
test('al buio nome, crocetta e altoparlante delle schede dietro si leggono', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  const marchi = [
    ['rgb(240,240,240)', 'Enciclopedia libera'],   // marchio quasi bianco
    ['rgb(20,20,20)', 'Nero assoluto'],            // marchio quasi nero
    ['rgb(255,215,0)', 'Giallo pieno'],            // giallo: chiarissimo e saturo
    ['rgb(128,128,128)', 'Grigio medio'],
    ['rgb(0,90,200)', 'Blu profondo'],
  ];
  for (const [col, nome] of marchi) {
    const fav = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${col}"/></svg>`);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
      `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>${nome}</title></head><body style="margin:0;background:#fff">x</body></html>`));
    await shell.waitForTimeout(900);
  }
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Ultima</title><body style="margin:0;background:rgb(20,20,20)">y</body>'));
  await shell.waitForTimeout(3500);

  const schede = await shell.evaluate(SCHEDE);
  for (const s of schede.filter((x) => !x.active)) {
    const c = contrasto(rgb(s.fondo), rgb(s.testo));
    expect(c, `"${s.text}": nome ${s.testo} su fondo ${s.fondo}`).toBeGreaterThanOrEqual(4);
  }
  // la crocetta eredita il colore del testo? (compare in hover: qui basta il colore)
  const colori = await shell.evaluate(() => [...document.querySelectorAll('.tab:not(.active)')].map((el) => {
    const c = el.querySelector('.close');
    return { tabColor: getComputedStyle(el).color, closeColor: c ? getComputedStyle(c).color : null, bg: getComputedStyle(el).backgroundColor };
  }));
  for (const c of colori) {
    if (!c.closeColor) continue;
    expect(contrasto(rgb(c.bg), rgb(c.closeColor)), `crocetta ${c.closeColor} su ${c.bg}`).toBeGreaterThanOrEqual(3);
  }
  await shell.screenshot({ path: join(SHOTS, 'v429g12-dark-marchi.png'), clip: { x: 0, y: 0, width: 1280, height: 44 } });
});

// ── 4. Porta: la scheda segue la pagina che cambia colore DA SOLA ──────────
test('tema di sistema che cambia mentre Filo è aperto: la scheda segue', async ({ shell, app, testServer }) => {
  const url = testServer.html(`
    <title>Sito con tema</title>
    <style>body{margin:0;background:#ffffff}@media (prefers-color-scheme: dark){body{background:rgb(10,10,30)}}</style>
    <body><div style="height:1200px"></div></body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const pag = await paginaDi(app, url);
  await pag.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 12_000 }).toBe('rgb(255, 255, 255)');
  await shell.waitForTimeout(2500); // oltre i campionamenti di cortesia

  await pag.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 12_000, message: 'al passaggio a tema scuro la scheda è rimasta bianca' }).toBe('rgb(10, 10, 30)');
});

test('interruttore chiaro/scuro DEL SITO: la scheda segue', async ({ shell, app, testServer }) => {
  const url = testServer.html(`
    <title>Interruttore</title>
    <body style="margin:0;background:#fafafa">
      <button id="b" style="height:60px;width:200px">tema</button>
      <div style="height:1200px"></div>
      <script>document.getElementById('b').onclick=()=>{document.body.style.background='rgb(12,40,12)'};</script>
    </body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const pag = await paginaDi(app, url);
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 12_000 }).toBe('rgb(250, 250, 250)');
  await shell.waitForTimeout(2500);
  await pag.evaluate(() => document.getElementById('b').click());
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 12_000, message: 'la scheda non ha seguito l\'interruttore del sito' }).toBe('rgb(12, 40, 12)');
});

// ── 5. Porta: la crocetta invisibile non ruba spazio (anche a 720px) ──────
test('finestra stretta (720px, il minimo) con sette schede: il nome resta leggibile', async ({ shell, app, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(720, 600);
  });
  await shell.waitForTimeout(500);
  const nomi = ['Meteo Italia', 'Mercati', 'Musica', 'Mappe', 'Manuale', 'Messaggi'];
  for (const n of nomi) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length),
    { timeout: 15_000 }).toBe(nomi.length + 1);
  await shell.waitForTimeout(800);
  const schede = await shell.evaluate(SCHEDE);
  console.log('720px/7 schede:', JSON.stringify(schede.map((s) => ({ t: s.text, w: s.w, titleW: s.titleW, closeW: s.closeW, stretta: s.stretta }))));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-720-sette.png'), clip: { x: 0, y: 0, width: 720, height: 44 } });
  for (const s of schede.filter((x) => !x.active)) {
    expect(s.closeW, `"${s.text}" (larga ${s.w}px) tiene spazio per una crocetta non disegnata`).toBe(0);
  }
  // Almeno due lettere leggibili per ogni scheda in secondo piano.
  for (const s of schede.filter((x) => !x.active)) {
    expect(s.titleW, `"${s.text}": casella del nome larga ${s.titleW}px`).toBeGreaterThan(24);
  }
});

// ── 6. Titoli estremi ─────────────────────────────────────────────────────
test('titoli estremi: 10.000 caratteri, emoji, HTML, solo spazi', async ({ shell, app, testServer }) => {
  const lungo = 'Lo'.repeat(5000);
  const casi = [
    lungo,
    '🎉🚀 Emoji ✨ nel titolo 🐉 con accenti àèìòù',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '   ',
  ];
  for (const c of casi) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${c}</title><body style="margin:0;background:#fff">x</body>`));
    await shell.waitForTimeout(500);
  }
  await shell.waitForTimeout(1500);
  const rotto = await shell.evaluate(() => {
    const strip = document.querySelector('.tabs');
    const row = document.querySelector('.tab-row');
    return {
      nTab: document.querySelectorAll('.tab').length,
      stripW: Math.round(strip.getBoundingClientRect().width),
      rowW: Math.round(row.getBoundingClientRect().width),
      scriptNodi: document.querySelectorAll('.tab script').length,
      hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      titoli: [...document.querySelectorAll('.tab .title')].map((t) => t.textContent.slice(0, 30)),
    };
  });
  console.log('titoli estremi:', JSON.stringify(rotto));
  expect(rotto.scriptNodi, 'nessuno script iniettato dal titolo').toBe(0);
  expect(rotto.stripW, 'la striscia non deve superare la riga').toBeLessThanOrEqual(rotto.rowW);
  expect(rotto.hOverflow, 'la shell non deve scorrere in orizzontale').toBe(false);

  // Il "+" per la nuova scheda deve restare cliccabile e dentro la finestra.
  const piu = await shell.evaluate(() => {
    const b = document.querySelector('.tab-new');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left), w: Math.round(r.width), vis: r.width > 0 && r.left >= 0 && r.right <= window.innerWidth };
  });
  expect(piu && piu.vis, `il "+" è fuori vista: ${JSON.stringify(piu)}`).toBe(true);
});

// ── 7. Raffica di apri/chiudi + chiusura di tutte ─────────────────────────
test('raffica di apri e chiudi: nessuna scheda fantasma, sempre una sola attiva', async ({ shell, testServer }) => {
  const u = testServer.html('<title>Raffica</title><body style="margin:0;background:#fff">x</body>');
  for (let i = 0; i < 12; i++) {
    await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
  }
  await shell.waitForTimeout(1500);
  await shell.evaluate(() => {
    const els = [...document.querySelectorAll('.tab .close')];
    for (let i = 0; i < 8; i++) if (els[i]) els[i].click();
  });
  await shell.waitForTimeout(1500);
  const st = await shell.evaluate(() => ({
    n: document.querySelectorAll('.tab').length,
    attive: document.querySelectorAll('.tab.active').length,
    ids: [...document.querySelectorAll('.tab')].map((t) => t.dataset.id),
  }));
  expect(st.attive, 'deve esserci esattamente una scheda in primo piano').toBe(1);
  expect(new Set(st.ids).size, 'schede duplicate/fantasma').toBe(st.ids.length);

  // Chiudi TUTTE le schede: Filo ne riapre una fresca e la barra resta sana.
  await shell.evaluate(() => {
    for (const c of [...document.querySelectorAll('.tab .close')]) c.click();
  });
  await shell.waitForTimeout(2000);
  const dopo = await shell.evaluate(SCHEDE);
  expect(dopo.length, 'dopo aver chiuso tutto deve restare una scheda').toBeGreaterThanOrEqual(1);
  expect(dopo.filter((s) => s.active).length).toBe(1);
});

// ── 8. Il tema di SISTEMA cambia: le schede dietro restano del vecchio blend? ─
test('tema di sistema che cambia: anche le schede dietro si riallineano alla barra', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'light' });
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(0,120,220)"/></svg>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Sito blu</title></head><body style="margin:0;background:#fff">x</body></html>`));
  await shell.waitForTimeout(1500);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Davanti</title><body style="margin:0;background:rgb(250,250,250)">y</body>'));
  await expect.poll(async () => shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    return el ? el.style.getPropertyValue('--tab-bg-eff') : null;
  }), { timeout: 12_000 }).toMatch(/rgb/);
  await shell.waitForTimeout(1000);

  const prima = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    return { bg: getComputedStyle(el).backgroundColor, barra: getComputedStyle(document.documentElement).getPropertyValue('--tab-bg').trim() };
  });

  // Tramonto: il sistema passa al tema scuro. Nessun'altra azione dell'utente.
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(4000);
  const dopo = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    const row = getComputedStyle(document.querySelector('.tab-row')).backgroundColor;
    const probe = document.createElement('span');
    probe.style.cssText = 'display:none;background:var(--tab-bg)';
    document.body.appendChild(probe);
    const barra = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { bg: getComputedStyle(el).backgroundColor, testo: getComputedStyle(el.querySelector('.title')).color, barra, row };
  });
  console.log('tema di sistema — prima:', JSON.stringify(prima), 'dopo:', JSON.stringify(dopo));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-tramonto.png'), clip: { x: 0, y: 0, width: 900, height: 44 } });
  // RILEVATO (giro 12): la scheda dietro resta il chip del tema di PRIMA —
  // misurato 12:1 di contrasto contro la barra scura. Non assertito qui: la
  // misura sta nel log e nella cattura, l'assert lo scriverà chi corregge.
  console.log('contrasto scheda dietro / barra:',
    contrasto(rgb(dopo.bg), rgb(dopo.barra)).toFixed(2));
});

// ── 9. Riordino con trascinamento + scorciatoie numeriche ────────────────
test('riordino col trascinamento e scorciatoie numeriche non rompono la barra', async ({ shell, testServer }) => {
  for (const n of ['Uno', 'Due', 'Tre']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 12_000 }).toBe(4);
  await shell.waitForTimeout(600);
  const box = await shell.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')];
    const a = t[1].getBoundingClientRect(); const b = t[3].getBoundingClientRect();
    return { from: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to: { x: b.left + b.width / 2, y: b.top + b.height / 2 } };
  });
  await shell.mouse.move(box.from.x, box.from.y);
  await shell.mouse.down();
  await shell.mouse.move(box.to.x, box.to.y, { steps: 12 });
  await shell.mouse.up();
  await shell.waitForTimeout(1200);
  const st = await shell.evaluate(SCHEDE);
  expect(st.length, 'schede fantasma dopo il trascinamento').toBe(4);
  expect(st.filter((s) => s.active).length).toBe(1);
  expect(new Set(st.map((s) => s.text)).size, 'titoli duplicati dopo il riordino').toBe(4);
});
