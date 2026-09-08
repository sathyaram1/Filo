// Sonda 5 verificatore #498 — passata funzionale: quattro schede-lista, dati
// veri, tema scuro, ricerca, testi mostruosi.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);

function feedbackFinto(i) {
  const stati = ['new', 'queued', 'resolved', 'archived'];
  return {
    id: `fb-${i}`,
    seq: 100 + i,
    num: `#${100 + i}`,
    name: i === 3 ? '<script>window.__pwn=1</script> 😀 日本語 テスト' : `Segnalazione numero ${i}`,
    text: i === 4 ? 'X'.repeat(10000)
      : i === 5 ? 'B'.repeat(4000)
        : i === 6 ? '<img src=x onerror="window.__pwn2=1"> javascript:alert(1) 🎉🎉🎉'
          : `Testo della segnalazione ${i}`,
    url: 'filo://manage/manage.html',
    images: [],
    status: stati[i % 4],
    createdAt: { _seconds: Math.floor(Date.now() / 1000) - i * 1000, _nanoseconds: 0 },
  };
}

test('sonda5: dati veri, quattro schede, tema scuro', async ({ app, openTab }) => {
  test.setTimeout(240000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate((lista) => window.__mgTest.setData(lista),
    Array.from({ length: 40 }, (_, i) => feedbackFinto(i)));
  await page.waitForTimeout(600);

  const geo = () => page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return {
      gridH: Math.round(g.height), gridTop: Math.round(g.top),
      viewport: doc.clientHeight,
      vuotoSotto: doc.clientHeight - Math.round(g.bottom),
      scroll: doc.scrollHeight - doc.clientHeight,
      sbordo: doc.scrollWidth - doc.clientWidth,
    };
  });

  for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.locator(`.mg-tab[data-tab="${t}"]`).click();
    await page.waitForTimeout(350);
    console.log(`SCHEDA ${t}`, JSON.stringify(await geo()));
  }
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await page.waitForTimeout(300);

  // Apro una segnalazione: la conversazione scorre dentro la colonna?
  const righe = page.locator('#mgListCol .mg-item, #mgListCol [data-fb-id], #mgListCol li');
  console.log('RIGHE LISTA', await righe.count());
  if (await righe.count()) {
    await righe.first().click();
    await page.waitForTimeout(500);
    console.log('APERTA', JSON.stringify(await geo()));
  }
  const pwn = await page.evaluate(() => [!!window.__pwn, !!window.__pwn2]);
  console.log('XSS ESEGUITO?', JSON.stringify(pwn));
  console.log('SCRIPT NEL DOM?', await page.evaluate(() =>
    document.querySelectorAll('#mgListCol script, #mgDetailCol script, #mgListCol img[onerror]').length));

  // Ricerca aperta con risultati
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('segnalazione');
  await page.waitForTimeout(800);
  console.log('CON RICERCA', JSON.stringify(await geo()));
  await page.screenshot({ path: 'tests/.shots/v498-g3-ricerca.png' });
  await page.locator('#mgSearchClose').click();
  await page.waitForTimeout(300);

  // Stacco fra barra delle schede e barra di ricerca (porta chiusa al giro 1)
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  console.log('STACCO', JSON.stringify(await page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const b = document.getElementById('mgSearchBar').getBoundingClientRect();
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return { sopra: Math.round(b.top - t.bottom), sotto: Math.round(g.top - b.bottom) };
  })));
  await page.locator('#mgSearchClose').click();

  // Tema scuro
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-g3-scuro.png' });
  console.log('SCURO', JSON.stringify(await geo()));

  // Ridimensionamento a pagina aperta
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  for (const [w, h] of [[1600, 900], [1000, 700], [1280, 800]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    console.log(`RIDIM ${w}x${h}`, JSON.stringify(await geo()));
  }
  await page.screenshot({ path: 'tests/.shots/v498-g3-pieno.png' });
});
