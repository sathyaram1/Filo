// #429 — terza tornata: quante schede servono perché il nome sparisca di nuovo,
// e cosa succede al suggerimento (tooltip) con un titolo enorme.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const MISURA = () => {
  const strip = document.querySelector('.tabs');
  const tabs = [...document.querySelectorAll('.tab')].map((el) => {
    const t = el.querySelector('.title');
    const c = el.querySelector('.close');
    const r = el.getBoundingClientRect();
    return {
      text: t ? t.textContent : '',
      w: Math.round(r.width),
      titleW: t ? Math.round(t.getBoundingClientRect().width) : 0,
      closeW: c ? Math.round(c.getBoundingClientRect().width) : 0,
      closeOpacity: c ? getComputedStyle(c).opacity : null,
      active: el.classList.contains('active'),
    };
  });
  return { tabs, winW: window.innerWidth, stripW: Math.round(strip.getBoundingClientRect().width) };
};

test.describe.configure({ mode: 'serial' });

test('#429/12 — a quante schede il nome torna a sparire su una finestra normale', async ({ shell, testServer }) => {
  const titoli = ['Meteo Italia oggi', 'Mercati e finanza', 'Musica classica', 'Mappe e percorsi',
    'Manuale utente', 'Messaggi', 'Marketplace', 'Modelli 3D', 'Motori di ricerca', 'Mostra fotografica'];
  for (let i = 0; i < titoli.length; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${titoli[i]}</title><body style="margin:0;background:#fff">x</body>`));
    await shell.waitForTimeout(150);
    if (i === 3 || i === 5 || i === 7 || i === 9) {
      await shell.waitForTimeout(1500);
      const m = await shell.evaluate(MISURA);
      const prima = m.tabs[0];
      console.log(`== ${m.tabs.length} schede su ${m.winW}px: prima scheda larga ${prima.w}px, area titolo ${prima.titleW}px, testo "${prima.text}"`);
      console.log('   larghezze:', m.tabs.map((t) => t.w).join(','));
      console.log('   chiusura invisibile occupa', prima.closeW, 'px (opacity', prima.closeOpacity, ')');
      await shell.screenshot({ path: join(SHOTS, `v429-schede-${m.tabs.length}.png`), clip: { x: 0, y: 0, width: m.winW, height: 44 } });
    }
  }
});

test('#429/13 — il suggerimento di una scheda con titolo mostruoso', async ({ shell, testServer }) => {
  const url = testServer.html(`<title>${'B'.repeat(9000)}</title><body style="margin:0;background:#fff">x</body>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(2500);
  const info = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => t.classList.contains('active'));
    return { tip: el.dataset.tip ? el.dataset.tip.length : 0, titolo: el.querySelector('.title').textContent.length };
  });
  console.log('lunghezza suggerimento:', info.tip, 'lunghezza titolo nel DOM:', info.titolo);
  // passa il mouse sopra e guarda il riquadro
  const box = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => t.classList.contains('active'));
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await shell.mouse.move(box.x, box.y);
  await shell.waitForTimeout(1600);
  const tip = await shell.evaluate(() => {
    const t = document.querySelector('.tip, .tooltip, [class*="tip"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { cls: t.className, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), txt: (t.textContent || '').length };
  });
  console.log('riquadro suggerimento:', JSON.stringify(tip));
  await shell.screenshot({ path: join(SHOTS, 'v429-tip-mostruoso.png') });
});
