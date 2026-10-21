import { test, expect } from '../../fixtures/electron.mjs';

const notifiche = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1').map((c) => c.textContent.trim()));

const casi = {
  mouseHref: `<button id="b" onclick="location.href='file:///srv/x/mouse.pdf'">Apri</button>`,
  tastiera: `<button id="b" onclick="location.href='file:///srv/x/tastiera.pdf'">Apri</button>`,
  assign: `<button id="b" onclick="location.assign('file:///srv/x/assign.pdf')">Apri</button>`,
  replace: `<button id="b" onclick="location.replace('file:///srv/x/replace.pdf')">Apri</button>`,
  openData: `<button id="b" onclick="window.open('data:text/html,<h1>ciao</h1>')">Apri</button>`,
  hrefData: `<button id="b" onclick="location.href='data:text/html,<h1>ciao</h1>'">Apri</button>`,
  form: `<form action="file:///srv/x/form.pdf"><button id="b">Invia</button></form>`,
  blank: `<a id="b" href="file:///srv/x/blank.pdf" target="_blank" style="display:block;width:300px;height:40px">doc</a>`,
  aClick: `<button id="b" onclick="var a=document.createElement('a');a.href='file:///srv/x/aclick.pdf';document.body.appendChild(a);a.click()">Apri</button>`,
  ritardo: `<button id="b" onclick="setTimeout(function(){location.href='file:///srv/x/ritardo.pdf'},1500)">Apri</button>`,
  ritardoFetch: `<button id="b" onclick="fetch(location.href).then(function(){return new Promise(function(r){setTimeout(r,2500)})}).then(function(){location.href='file:///srv/x/fetch.pdf'})">Apri</button>`,
  iframeTop: `<iframe srcdoc="<button id=b style='width:300px;height:40px' onclick=&quot;top.location.href='file:///srv/x/top.pdf'&quot;>x</button>" style="width:400px;height:80px"></iframe>`,
  dataPdf: `<a id="b" href="data:application/pdf;base64,JVBERi0xLjQK" style="display:block;width:300px;height:40px">pdf</a>`,
};

for (const [nome, corpo] of Object.entries(casi)) {
  test(`esplora pagina ${nome}`, async ({ shell, openTab, testServer }) => {
    const page = await openTab(testServer.html(`<title>${nome}</title><style>body{margin:0}button,a{width:300px;height:40px;display:block}</style>${corpo}`));
    await page.waitForTimeout(800);
    if (nome === 'tastiera') { await page.focus('#b'); await page.keyboard.press('Enter'); }
    else await page.mouse.click(40, 20);
    await page.waitForTimeout(nome.startsWith('ritardo') ? 5000 : 2000);
    console.log(`[${nome}]`, JSON.stringify(await notifiche(shell)), page.url());
  });
}
