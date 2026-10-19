// Esplorazione #798 giro 3: quando nasce la finestra di un embed/object, e quali eventi arrivano.
import { test } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><body><p>ok</p></body>';

test('esplora embed', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const out = await page.evaluate(async () => {
    const log = [];
    window.addEventListener('load', (e) => log.push('load ' + (e.target && e.target.tagName) + ' len=' + window.length), true);
    for (const tag of ['embed', 'object']) {
      const e = document.createElement(tag);
      e.type = 'text/html';
      if (tag === 'embed') e.src = 'about:blank'; else e.data = 'about:blank';
      document.body.appendChild(e);
      log.push(tag + ' subito len=' + window.length + ' cw=' + (e.contentWindow ? 'si' : 'no'));
      void e.offsetWidth; void document.body.getBoundingClientRect();
      log.push(tag + ' dopo layout len=' + window.length + ' cw=' + (e.contentWindow ? 'si' : 'no'));
      await Promise.resolve();
      log.push(tag + ' microtask len=' + window.length);
      await new Promise((r) => setTimeout(r, 0));
      log.push(tag + ' task len=' + window.length + ' cw=' + (e.contentWindow ? 'si' : 'no'));
      await new Promise((r) => setTimeout(r, 500));
      const w = window[window.length - 1];
      log.push(tag + ' 500ms len=' + window.length + ' href=' + (w && w.location.href) + ' fe=' + (w && w.frameElement && w.frameElement.tagName));
    }
    return log;
  });
  console.log('ESITO ' + out.join(' | '));
});
