// Esplorazione (da cancellare): guarda la riga del diario di una lettura.

import { test } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

for (const tema of ['dark', 'light']) {
  test(`riga del diario, tema ${tema}`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await newtabPage(app);
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      const host = document.createElement('div');
      host.id = 'sonda';
      host.style.cssText = 'position:fixed;left:24px;top:24px;width:560px;z-index:99;padding:12px';
      document.body.appendChild(host);
      const A = globalThis.SN_DASH_ATTIVITA;
      const azioni = [
        { type: 'CERCA_WEB', query: 'prezzi modelli usciti questa settimana' },
        {
          type: 'LEGGI_PAGINA',
          url: 'https://blog.example.com/2026/09/listino-dei-modelli-usciti-questa-settimana',
          _output: {
            pageRead: 'https://blog.example.com/2026/09/listino-dei-modelli-usciti-questa-settimana',
            title: 'Listino dei modelli usciti questa settimana, con i costi per milione di token',
            ok: true, source: 'rete', text: 'x',
          },
        },
        {
          type: 'LEGGI_PAGINA',
          url: 'https://posta.example.com/inbox',
          _output: { pageRead: 'https://posta.example.com/inbox', title: 'Posta in arrivo', ok: true, source: 'scheda', text: 'x' },
        },
        {
          type: 'LEGGI_PAGINA',
          url: 'https://rotta.example.com/x',
          _output: { pageRead: 'https://rotta.example.com/x', ok: false, error: 'timeout', detail: 'il sito non ha risposto in tempo' },
        },
      ];
      A.renderActions(host, azioni, {});
    }, tema);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/giro11-diario-${tema}.png`, clip: { x: 0, y: 0, width: 640, height: 260 } });
  });
}
