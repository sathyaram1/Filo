// Verifica #530, giro 1 — come si vede il livello attivo nella home, e il
// selettore nelle Preferenze: temi, larghezze, e la pillola che non deve
// mangiarsi la riga dei controlli.

import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

const MISURE = [
  { nome: 'larga', width: 1280, height: 800 },
  { nome: 'media', width: 900, height: 700 },
  { nome: 'stretta', width: 620, height: 700 },
];

test('la pillola sta su una riga sola e non spinge fuori i controlli', async ({ openTab }) => {
  const home = await openTab('filo://dashboard/dashboard.html');
  const chip = home.locator('#dashAutonomia');
  await expect(chip).toBeVisible({ timeout: 10_000 });

  for (const m of MISURE) {
    await home.setViewportSize({ width: m.width, height: m.height });
    for (const tema of ['light', 'dark']) {
      await home.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
      await home.waitForTimeout(120);
      const g = await chip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          alt: Math.round(r.height), larg: Math.round(r.width),
          righe: Math.round(r.height / parseFloat(s.fontSize || '12')),
          colore: s.color, bordo: s.borderTopColor,
          sfondoPagina: getComputedStyle(document.body).backgroundColor,
          destra: Math.round(r.right),
          larghezzaPagina: document.documentElement.clientWidth,
        };
      });
      expect(g.colore, `${m.nome}/${tema}: la scritta ha il colore del fondo`).not.toBe(g.sfondoPagina);
      expect(g.destra, `${m.nome}/${tema}: la pillola esce dal bordo destro`).toBeLessThanOrEqual(g.larghezzaPagina + 1);
      expect(
        g.alt,
        `${m.nome}/${tema}: la pillola va a capo e diventa alta ${g.alt}px (i controlli accanto sono alti 34)`,
      ).toBeLessThanOrEqual(38);
      await home.screenshot({ path: `tests/.shots/530-home-${m.nome}-${tema}.png` }).catch(() => {});
    }
  }
});

test('il selettore nelle Preferenze si legge nei due temi', async ({ openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#autonomiaLivelli .aut-riga', { timeout: 10_000 });
  for (const tema of ['light', 'dark']) {
    await prefs.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await prefs.waitForTimeout(120);
    const righe = await prefs.locator('#autonomiaLivelli .aut-riga').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const frase = el.querySelector('.aut-frase');
        const fr = frase ? getComputedStyle(frase) : null;
        return {
          alt: Math.round(r.height),
          tagliata: frase ? frase.scrollWidth > frase.clientWidth + 1 : false,
          colore: s.color,
          coloreFrase: fr ? fr.color : '',
        };
      }));
    expect(righe.length, 'i livelli selezionabili sono tre').toBe(3);
    for (const [i, r] of righe.entries()) {
      expect(r.tagliata, `tema ${tema}: la frase del livello ${i + 1} è tagliata`).toBe(false);
      expect(r.alt, `tema ${tema}: riga del livello ${i + 1} schiacciata`).toBeGreaterThan(14);
    }
    await prefs.locator('#autonomiaSection').screenshot({ path: `tests/.shots/530-prefs-${tema}.png` }).catch(() => {});
  }
});
