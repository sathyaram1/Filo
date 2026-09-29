// Verifica #821, giro 1: schede non attive con la tinta viva del sito, cinque siti, due temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const svg = (inner) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${inner}</svg>`);
const page = (title, icon) => '<!doctype html><html><head>' +
  (icon ? `<link rel="icon" href="${icon}">` : '') +
  `<title>${title}</title></head><body style="margin:0;height:1200px">${title}</body></html>`;

const SITI = [
  ['Tubo rosso', svg('<rect width="32" height="32" rx="7" fill="rgb(255,0,0)"/><path d="M12 9 L23 16 L12 23 Z" fill="#fff"/>')],
  ['Posta gialla', svg('<rect width="32" height="32" fill="rgb(255,204,0)"/>')],
  ['Libro blu', svg('<rect width="32" height="32" rx="6" fill="rgb(24,119,242)"/>')],
  ['Musica verde', svg('<circle cx="16" cy="16" r="16" fill="rgb(30,215,96)"/>')],
  ['Enciclopedia bianca', svg('<rect width="32" height="32" fill="#fff"/><text x="6" y="24" font-size="20" fill="#000">W</text>')],
  ['Cinguettio nero', svg('<rect width="32" height="32" fill="#000"/><path d="M8 8 L24 24 M24 8 L8 24" stroke="#fff" stroke-width="3"/>')],
];

const lum = ([r, g, b]) => {
  const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const hslSat = ([r, g, b]) => {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2;
  if (mx === mn) return 0;
  return (mx - mn) / (1 - Math.abs(2 * l - 1));
};
const hue = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h / 6;
};
const hsl2rgb = (h, s, l) => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
};
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function leggiSchede(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const probe = document.createElement('div');
    probe.style.background = 'var(--tab-bg)';
    document.body.appendChild(probe);
    const bar = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      bar,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      tabs: [...document.querySelectorAll('.tab')].map((el) => {
        const t = snap.tabs.find((x) => String(x.id) === el.dataset.id) || {};
        return {
          tip: el.dataset.tip, active: el.classList.contains('active'), tinted: el.classList.contains('tinted'),
          identity: t.identityColor || null,
          bg: getComputedStyle(el).backgroundColor,
          title: getComputedStyle(el.querySelector('.title')).color,
          close: el.querySelector('.close') ? getComputedStyle(el.querySelector('.close')).color : null,
        };
      }),
    };
  });
}

function controlla(stato, op, tag) {
  const bar = nums(stato.bar);
  const out = [];
  for (const t of stato.tabs) {
    if (t.active || !t.identity) continue;
    const id = nums(t.identity);
    const chroma = Math.max(...id) - Math.min(...id);
    const adattato = chroma < 24 ? id : hsl2rgb(hue(id), 1, 0.5);
    const atteso = adattato.map((v, i) => v * op + bar[i] * (1 - op));
    const bg = nums(t.bg);
    out.push({ tag, tip: t.tip, identity: t.identity, bg, atteso: atteso.map(Math.round), sat: +hslSat(bg).toFixed(2),
      contrTitolo: +contrast(nums(t.title), bg).toFixed(2), contrX: t.close ? +contrast(nums(t.close), bg).toFixed(2) : null,
      ok: near(bg, atteso) });
  }
  return out;
}

test('cinque siti noti: tinta viva, formula, titolo leggibile, chiaro e scuro', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  for (const [title, icon] of SITI) await testServer.openReady(openTab, page(title, icon));
  await testServer.openReady(openTab, page('Pagina neutra', null));
  await expect.poll(async () => (await leggiSchede(shell)).tabs.filter((t) => !t.active && t.identity).length,
    { timeout: 15_000 }).toBeGreaterThanOrEqual(SITI.length);
  mkdirSync('tests/.shots', { recursive: true });
  const report = [];
  for (const scheme of ['light', 'dark']) {
    await shell.emulateMedia({ colorScheme: scheme });
    await shell.waitForTimeout(400);
    const s = await leggiSchede(shell);
    report.push(...controlla(s, 0.6, scheme));
    const w = await shell.evaluate(() => innerWidth);
    await shell.screenshot({ path: `tests/.shots/v821-barra-${scheme}.png`, clip: { x: 0, y: 0, width: w, height: 44 } });
    // hover su ogni scheda colorata
    for (const t of s.tabs.filter((x) => x.tinted)) {
      await shell.hover(`.tab[data-tip="${t.tip}"] .title`);
      await shell.waitForTimeout(200);
      const h = await leggiSchede(shell);
      const ht = h.tabs.find((x) => x.tip === t.tip);
      report.push({ tag: scheme + '-hover', tip: t.tip, bg: nums(ht.bg), contrTitolo: +contrast(nums(ht.title), nums(ht.bg)).toFixed(2) });
    }
    await shell.hover('.tab[data-tip="Tubo rosso"] .close');
    await shell.screenshot({ path: `tests/.shots/v821-hover-close-${scheme}.png`, clip: { x: 0, y: 0, width: 700, height: 44 } });
    await shell.mouse.move(5, 300);
  }
  writeFileSync('tests/.shots/v821-report.json', JSON.stringify(report));
  for (const r of report) {
    expect(r.contrTitolo, `${r.tag} ${r.tip}`).toBeGreaterThanOrEqual(4.5);
    if ('ok' in r) expect(r.ok, `${r.tag} ${r.tip} ${r.bg} vs ${r.atteso}`).toBe(true);
  }
});
