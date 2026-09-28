// Il menu del tasto destro sulla scheda è una finestra a parte che si chiude da sola (blur, clic su una voce):
// qui si apre e si clicca finché l'ESITO voluto non si vede, come in tests/proxy-tab-menu.spec.mjs.

import { expect } from '@playwright/test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tastoDestroScheda(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

export async function testoMenu(app, ago) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n) ? document.body.innerText : null), ago);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}

async function provaClic(app, ago, etichetta) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(({ n, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return false;
        const b = [...document.querySelectorAll('button.item')].find((x) => new RegExp(l).test(x.textContent));
        if (!b) return false;
        b.click();
        return true;
      }, { n: ago, l: etichetta });
      if (r) return true;
    } catch (_) {}
  }
  return false;
}

// `apri` porta in vista il menu che contiene `ago`; si clicca la voce `etichetta` finché `finche()` è vero.
export async function cliccaFinche(app, { apri, ago, etichetta, finche, timeout = 25_000 }) {
  await expect.poll(async () => {
    if (await finche()) return true;
    await apri();
    for (let i = 0; i < 15; i++) { if (await provaClic(app, ago, etichetta)) break; await sleep(40); }
    await sleep(150);
    return finche();
  }, { timeout, intervals: [150, 200, 250, 350, 450, 600, 800, 1000, 1200] }).toBe(true);
}
