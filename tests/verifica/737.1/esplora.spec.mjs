import { test, expect } from '../../fixtures/electron.mjs';

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return eval(src)(t, a);
}, [fn.toString(), arg]);
const urls = (app) => tm(app, (t) => t.tabs.map((x) => { try { return x.view.webContents.getURL(); } catch (_) { return x.url || ''; } }));
const aperte = async (app, u) => (await urls(app)).filter((x) => x.replace(/\?$/, '') === u).length;
const titolo = (app, host) => tm(app, (t, h) => {
  const x = t.tabs.find((y) => { try { return y.view.webContents.getURL().includes(h); } catch (_) { return false; } });
  return x ? x.view.webContents.getTitle() : '';
}, host);

const SONDA = `<title>N</title><p>articolo</p><script>
  setInterval(function(){ var a = navigator.userActivation.isActive; if (a && !window.__visto && window.__pronto) { window.__visto = 1;
    document.documentElement.requestFullscreen().then(function(){document.title='FS-SI'},function(){document.title='FS-NO'}); }
    if (!window.__visto) document.title = (a ? 'A' : 'N') + (window.__pronto ? 'P' : ''); }, 30);
  setTimeout(function(){ window.__pronto = 1 }, 6500);
</script>`;

for (const [nome, keys] of [
  ['Ctrl+L', [{ keyCode: 'Control', modifiers: ['control'] }, { keyCode: 'L', modifiers: ['control'] }]],
  ['Alt+E', [{ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'E', modifiers: ['alt'] }]],
  ['Alt+S', [{ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'S', modifiers: ['alt'] }]],
  ['Alt+1', [{ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: '1', modifiers: ['alt'] }]],
]) {
  test(`scorciatoia ${nome}: la pagina riceve un gesto?`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60000);
    await openTab(testServer.html(SONDA));
    await expect.poll(() => titolo(app, '127.0.0.1'), { timeout: 15000 }).toBe('NP');
    await tm(app, (t, ks) => {
      const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
      for (const k of ks) wc.sendInputEvent({ type: 'keyDown', ...k });
      for (const k of ks.slice().reverse()) wc.sendInputEvent({ type: 'keyUp', ...k });
    }, keys);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(nome, '=>', await titolo(app, '127.0.0.1'));
  });
}

test('chiusura della scheda: la pagina apre una scheda mentre la chiudi', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>ALLA CHIUSURA</title>', { pubblico: true });
  await openTab(testServer.html(`<title>Sito</title><script>
    window.addEventListener('pagehide', function(){ window.open(${JSON.stringify(bersaglio)}) });
    window.addEventListener('beforeunload', function(){ window.open(${JSON.stringify(bersaglio)}) });
    window.addEventListener('unload', function(){ window.open(${JSON.stringify(bersaglio)}) });</script>`));
  await new Promise((r) => setTimeout(r, 6000));
  await tm(app, (t) => t.closeTab(t.activeId));
  await new Promise((r) => setTimeout(r, 2500));
  console.log('chiusura =>', await aperte(app, bersaglio), JSON.stringify(await urls(app)));
});

test('scheda dietro: il clic nella scheda davanti non vale per quella dietro', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>DIETRO</title>');
  await openTab(testServer.html(`<title>Dietro</title><script>setInterval(function(){window.open(${JSON.stringify(bersaglio)})},200)</script>`));
  const davanti = await openTab(testServer.html('<title>Davanti</title><p style="height:300px">x</p>', { pubblico: true }));
  await new Promise((r) => setTimeout(r, 1000));
  await davanti.mouse.click(50, 50);
  await davanti.keyboard.press('a');
  await new Promise((r) => setTimeout(r, 2000));
  console.log('dietro =>', await aperte(app, bersaglio));
});

test('finestra di accesso aperta col clic che apre altro da sola', async ({ app, openTab, testServer }) => {
  const altro = testServer.html('<title>ALTRO</title>', { pubblico: true });
  const accesso = `${testServer.html(`<title>ACCESSO</title><script>setInterval(function(){window.open(${JSON.stringify(altro)})},300)</script>`)}?client_id=a&response_type=code`;
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')}, 'login', 'width=400,height=500')">Accedi</button>`));
  await page.click('#b');
  await new Promise((r) => setTimeout(r, 3000));
  console.log('accesso =>', await aperte(app, altro));
});
