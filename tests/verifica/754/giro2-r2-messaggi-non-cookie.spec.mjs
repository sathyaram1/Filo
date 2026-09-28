// #754 giro 2, rilievo 2: un messaggio di Sourcepoint che non parla di cookie (avviso adblock, invito ad abbonarsi a fine
// articoli gratuiti) non è un banner dei cookie: Filo non deve nasconderlo né dire «Banner dei cookie nascosto».
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function messaggio(testServer, testo, bottoni) {
  return testServer.html(`<title>SP_MSG</title><style>body{margin:0;font:14px sans-serif}</style>
    <div class="message-container"><div id="notice" class="message type-modal" style="padding:20px">
      <div class="message-component message-row"><p class="message-component">${testo}</p></div>
      <div class="message-component message-row">${bottoni.map((b) =>
        `<button class="message-component message-button no-children focusable sp_choice_type_9" title="${b}" onclick="parent.postMessage('sp:${b}','*')">${b}</button>`).join('')}</div>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
}

function pagina(frame) {
  return `<title>QUOTIDIANO</title>
    <style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}</style>
    <div id="sp_message_container_1" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center">
      <iframe id="sp_message_iframe_1" src="${frame}" style="width:560px;height:300px;border:0;background:#fff"></iframe>
    </div>
    <h1>Articolo</h1><p>Il testo dell'articolo.</p>
    <script>document.documentElement.classList.add('sp-message-open');</script>`;
}

async function stato(page, shell) {
  const visibile = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!el && !!el.closest('#sp_message_container_1');
  });
  const cookies = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.find((x) => x.id === snap.activeId).cookies;
  });
  return { visibile, nascosto: !!(cookies && cookies.hidden) };
}

for (const [nome, testo, bottoni] of [
  ['avviso adblock', 'Sembra che tu stia usando un adblocker. Disattivalo per sostenere il nostro giornalismo.', ['Ho disattivato l\'adblocker', 'Abbonati']],
  ['articoli gratuiti finiti', 'Hai letto i 5 articoli gratuiti di questo mese. Abbonati per continuare a leggere.', ['Abbonati', 'Accedi']],
]) {
  test(`messaggio Sourcepoint senza cookie (${nome}): resta, e il menu non parla di banner dei cookie`, async ({ openTab, testServer, shell }) => {
    const page = await testServer.openReady(openTab, pagina(messaggio(testServer, testo, bottoni)));
    await sleep(9000);
    expect(await stato(page, shell)).toEqual({ visibile: true, nascosto: false });
  });
}
