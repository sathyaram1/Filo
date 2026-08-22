// DIAGNOSTICA TEMPORANEA #444 — da cancellare.
import { test, expect } from './fixtures/electron.mjs';

async function labels(page, selector, position) {
  await page.locator(selector).click({ button: 'right', ...(position ? { position } : {}) });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const txt = await menu.evaluate((m) => Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()).join(' | '));
  await page.keyboard.press('Escape');
  return txt;
}

// A: video dentro <a> (baseline nota funzionante)
test('A video dentro a', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <a id="card" href="https://example.com/x"><video id="clip" src="/c.mp4" width="320" height="180" style="background:#333"></video></a>
  </body>`);
  console.log('A:', await labels(page, '#clip'));
});

// B: card con <a> e <video> SOVRAPPOSTO (il video non sta dentro il link)
test('B video sovrapposto al link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://example.com/x" style="position:absolute;inset:0"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAlWQMEXtHc5AAAAABJRU5ErkJggg==" style="width:100%;height:100%"></a>
      <video id="clip" src="/c.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
    </div>
  </body>`);
  console.log('B:', await labels(page, '#clip'));
});

// C: video dentro shadow root, <a> in light DOM fuori dall'host
test('C video in shadow dentro link light', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <a id="card" href="https://example.com/x"><preview-el></preview-el></a>
    <script>
      class P extends HTMLElement { constructor(){ super(); this.attachShadow({mode:'open'}).innerHTML =
        '<video id="clip" src="/c.mp4" width="320" height="180" style="background:#333"></video>'; } }
      customElements.define('preview-el', P);
    </script>
  </body>`);
  console.log('C:', await labels(page, 'preview-el'));
});

// D: link dentro shadow root, video dentro lo stesso shadow root ma link antenato -> ok atteso
test('D tutto in shadow', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <preview-el2></preview-el2>
    <script>
      class P2 extends HTMLElement { constructor(){ super(); this.attachShadow({mode:'open'}).innerHTML =
        '<a href="https://example.com/x"><video id="clip" src="/c.mp4" width="320" height="180" style="background:#333"></video></a>'; } }
      customElements.define('preview-el2', P2);
    </script>
  </body>`);
  console.log('D:', await labels(page, 'preview-el2'));
});
