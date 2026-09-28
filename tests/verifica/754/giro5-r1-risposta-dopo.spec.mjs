// #754 giro 5, rilievo 1: «Mostra il banner dei cookie» deve togliere anche la risposta che la pagina scrive
// dopo il clic (banner in un riquadro, o risposta segnata al ritorno di una richiesta al server).

import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

async function tryClick(app, needle) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate((n) => {
        if (!document.body || !document.body.innerText.includes(n)) return 'no';
        const btn = [...document.querySelectorAll('button.item')].find((b) => b.textContent.includes(n));
        if (!btn) return 'no';
        btn.click();
        return 'yes';
      }, needle);
      if (r === 'yes') return true;
    } catch (_) {}
  }
  return false;
}

async function mostraIlBanner(app, shell) {
  await expect.poll(async () => {
    if ((await tabCookies(shell))?.shown === true) return true;
    await rightClickTab(shell);
    for (let i = 0; i < 15; i++) { if (await tryClick(app, 'Mostra il banner dei cookie')) break; await sleep(40); }
    await sleep(200);
    return (await tabCookies(shell))?.shown === true;
  }, { timeout: 25_000, intervals: [200, 300, 450, 600, 800, 1000, 1200] }).toBe(true);
}

function spFramePage(testServer) {
  const frame = testServer.html(`<title>SP_FRAME</title>
    <div class="message-container"><div class="message type-modal" style="padding:20px">
      <p>Usiamo i cookie per personalizzare la pubblicità.</p>
      <button class="message-component message-button sp_choice_type_11" title="Accept"
        onclick="parent.postMessage('sp:accept','*')">Accetta</button>
      <button class="message-component message-button sp_choice_type_13" title="Reject All"
        onclick="parent.postMessage('sp:reject','*')">Rifiuta</button>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
  return `<title>SP_TOP</title>
    <p>contenuto</p>
    <script>
      if (!document.cookie.includes('scelta_privacy=')) {
        document.write('<div id="sp_message_container_1" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;display:flex;align-items:center;justify-content:center"><iframe id="sp_message_iframe_1" src="${frame}" style="width:520px;height:320px;border:0;background:#fff"></iframe></div>');
      }
      addEventListener('message', (e) => {
        if (e.data !== 'sp:reject' && e.data !== 'sp:accept') return;
        document.cookie = 'scelta_privacy=' + (e.data === 'sp:reject' ? 'no' : 'si') + '; path=/; max-age=86400';
        const c = document.getElementById('sp_message_container_1');
        if (c) c.remove();
      });
    </script>`;
}

test('banner in un riquadro, la pagina si segna la risposta: «Mostra il banner dei cookie» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, spFramePage(testServer));
  await page.waitForFunction(() => document.cookie.includes('scelta_privacy=no'), null, { timeout: 12_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(500);
  await mostraIlBanner(app, shell);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('sp_message_container_1')).catch(() => false), { timeout: 10_000 }).toBe(true);
});

const DOPO_IL_SERVER = `<title>DOPO_IL_SERVER</title>
  <script>
    if (!document.cookie.includes('scelta_sito=')) {
      document.write('<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff"><p>Usiamo i cookie.</p>'
        + '<button onclick="salva(\\'si\\')">Accetta</button> <button onclick="salva(\\'no\\')">Rifiuta</button></div>');
    }
    function salva(v) {
      fetch(location.href).then(() => {
        document.cookie = 'scelta_sito=' + v + '; path=/; max-age=86400';
        const b = document.getElementById('cookie-banner'); if (b) b.remove();
      });
    }
  </script>`;

test('banner che segna la risposta al ritorno dal server: «Mostra il banner dei cookie» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, DOPO_IL_SERVER);
  await page.waitForFunction(() => document.cookie.includes('scelta_sito=no'), null, { timeout: 12_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(500);
  await mostraIlBanner(app, shell);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('cookie-banner')).catch(() => false), { timeout: 10_000 }).toBe(true);
});
