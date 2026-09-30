// #725 — l'avviso su un link sospetto, nel menu del tasto destro: deve essere
// una frase che chiunque capisce (prima usciva il codice interno
// «⚠️ Link sospetto: typosquatting:paypal.com») e deve esserci anche quando la
// spiegazione del modello non arriva.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Pagina di prova</h1>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
  <p><a id="pulito" href="https://esempio-tranquillo.test/articolo">Un articolo qualunque</a></p>
  <p><a id="gitlab" href="https://gitlab.com/gitlab-org/gitlab">Il progetto su GitLab</a></p>
</body></html>`;

test('un link che imita un dominio noto lo dice a parole', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#falso').click({ button: 'right' });

  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();

  const avviso = menu.locator('.sn-menu-link-warn');
  await expect(avviso).toBeVisible();
  const testo = ((await avviso.textContent()) || '').trim();

  // Il successo per chi legge: capisce cosa rischia e vede il dominio imitato,
  // senza che nessuno gli spieghi cos'è il typosquatting.
  expect(testo).toContain('paypal.com');
  expect(testo).toMatch(/imitazione/i);
  expect(testo).toMatch(/\.$/);
  expect(testo).not.toMatch(/typosquatting|side_effect|token_in_url|url_invalido/);

  await page.screenshot({ path: 'tests/.shots/725-link-sospetto.png' });
});

test('l’avviso c’è prima e a prescindere dalla spiegazione del modello', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#falso').click({ button: 'right' });
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  // Compare da subito: non aspetta il primo pezzo della risposta AI, che in un
  // ambiente senza provider non arriva mai.
  await expect(avviso).toBeVisible({ timeout: 3000 });
  // E resta lì mentre la sezione finisce come può.
  await page.waitForTimeout(1500);
  await expect(avviso).toBeVisible();
  expect(((await avviso.textContent()) || '')).toContain('paypal.com');
});

test('un link normale non si prende un avviso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#pulito').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
});

test('un indirizzo di tutti i giorni non si prende l’avviso', async ({ openTab, testServer }) => {
  // #725 — il confronto con i nomi famosi correva su tutto l'indirizzo con due
  // lettere fisse di tolleranza, e gitlab.com «imitava» github.com. Un avviso
  // rosso sui link di ogni giorno smette di essere letto quando serve.
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#gitlab').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
});

test('la spiegazione arriva da sola: nel menu non c’è niente da cliccare', async ({ openTab, testServer }) => {
  // Il manifesto prometteva «Spiega link» e «Spiegazione», voci che non
  // esistono: la sezione si riempie da sola all'apertura del menu (#725).
  const page = await testServer.openReady(openTab, HTML);
  const menu = page.locator('.sn-menu');

  await page.locator('#falso').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await expect(menu.getByText(/^Spieg/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('h1').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.locator('h1').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="text"]')).toBeVisible();
  await expect(menu.getByText(/^Spiegazione$/)).toHaveCount(0);
});

// #725.1 — quando il punto cliccato è un'immagine che apre un collegamento
// (locandina, banner, logo di una scheda) la sezione del menu parla
// dell'immagine: l'avviso sull'indirizzo deve esserci lo stesso, in tutte le
// forme in cui immagine e collegamento stanno insieme.
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FALSO = 'https://paypa1.com/login';
const SCHEDE = {
  'immagine dentro il link': `<a id="lnk" href="${FALSO}"><img id="clic" src="${PX}" width="240" height="140" style="background:#e07b39"></a>`,
  'copertina stesa sopra il link': `<div style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${FALSO}" style="position:absolute;inset:0;display:block"></a>
      <img id="clic" src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39"></div>`,
  'velo dentro il link sopra la copertina': `<a id="lnk" href="${FALSO}" style="position:relative;display:block;width:320px;height:180px">
      <img src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
      <span id="clic" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span></a>`,
  'scheda a strati: velo sopra, copertina e link sotto': `<div style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${FALSO}" style="position:absolute;inset:0;display:block"></a>
      <img src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
      <span id="clic" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span></div>`,
};

for (const [forma, scheda] of Object.entries(SCHEDE)) {
  test(`immagine-link sospetta (${forma}): il menu dice dell'imitazione`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${scheda}</body></html>`);
    await page.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
    const menu = page.locator('.sn-menu');
    await expect(menu).toBeVisible();
    // È davvero il menu dell'immagine-link: voci del collegamento e sezione dell'immagine.
    await expect(menu.getByText('Apri in nuova tab').first()).toBeVisible();
    const sezione = menu.locator('.sn-menu-inline[data-subject="image"]');
    await expect(sezione).toBeVisible();
    const avviso = sezione.locator('.sn-menu-link-warn');
    await expect(avviso).toBeVisible({ timeout: 3000 });
    const testo = ((await avviso.textContent()) || '').trim();
    expect(testo).toContain('paypal.com');
    expect(testo).toMatch(/imitazione/i);
    if (forma === 'immagine dentro il link') {
      await page.screenshot({ path: 'tests/.shots/725-1-immagine-link-sospetta.png' });
    }
  });
}

test('un’immagine dentro un link normale non si prende l’avviso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <a href="https://esempio-tranquillo.test/articolo"><img id="clic" src="${PX}" width="240" height="140" style="background:#e07b39"></a></body></html>`);
  await page.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="image"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
});

// #725.8 — il menu conosceva solo quattordici nomi famosi internazionali: le
// imitazioni di Poste, banche e WhatsApp passavano senza avviso, e un nome
// famoso su un dominio qualsiasi (paypal.support) era preso per il sito vero.
const IMITAZIONI = {
  'https://poste.it.accesso-sicuro.net/login': 'Poste Italiane',
  'https://intesasanpaolo.com.accesso.net/': 'Intesa Sanpaolo',
  'https://unicredit-sicurezza.com/': 'UniCredit',
  'https://whatsapp-web.com.accesso.net/': 'WhatsApp',
  'https://bancoposta-online.com/': 'Poste Italiane',
  'https://posteitaliane.it.accesso-sicuro.net/': 'Poste Italiane',
  'https://www.google.com/url?q=https://whatsappweb.accesso.net/': 'WhatsApp',
  'https://inps-rimborso.com/': 'INPS',
  'https://paypal.support/': 'PayPal',
  'https://netflix.top/': 'Netflix',
  'https://amazon.shop/': 'Amazon',
  'https://urldefense.com/v3/__https://poste.it.accesso-sicuro.net/login__;!!AbC123!xYz$': 'Poste Italiane',
  'https://www.paypal.com@accesso-sicuro.net/login': 'PayPal',
};

test('le imitazioni di Poste, banche, WhatsApp e i nomi famosi su un altro dominio hanno l’avviso', async ({ openTab, testServer }) => {
  const link = Object.keys(IMITAZIONI).map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}
    <p><a id="vero" href="https://www.poste.it/">Poste vero</a></p></body></html>`);
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  let i = 0;
  for (const [u, marchio] of Object.entries(IMITAZIONI)) {
    await page.locator('#l' + i++).click({ button: 'right' });
    await expect(avviso, `nessun avviso su ${u}`).toBeVisible({ timeout: 3000 });
    const testo = ((await avviso.textContent()) || '').trim();
    expect(testo, u).toContain(marchio);
    expect(testo, u).toMatch(/imitazione/i);
    if (u.includes('poste.it.accesso')) await page.screenshot({ path: 'tests/.shots/725-8-imitazione-poste.png' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  // Il sito vero resta pulito.
  await page.locator('#vero').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(avviso).toHaveCount(0);
});

test('i siti veri con un nome vicino a un marchio non si prendono l’avviso', async ({ openTab, testServer }) => {
  // #725.8 giro 1 — col giudizio dell'apertura il menu ne ereditava i falsi allarmi: indirizzi ufficiali che
  // l'elenco non conosceva (revolut.me, apple.co) e parole vere (telegraph, cloud, imposte).
  const veri = ['https://www.telegraph.co.uk/news/', 'https://www.cloud.it/', 'https://revolut.me/mario', 'https://apple.co/3abcdEf',
    'https://cdn.discordapp.com/attachments/1/2/foto.png', 'https://www.imposte.it/', 'https://spid.register.it/login/selfcare/login',
    'https://github.blog/changelog/'];
  const link = veri.map((u, i) => `<p><a id="v${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const conAvviso = [];
  for (let i = 0; i < veri.length; i++) {
    await page.locator('#v' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    if (await page.locator('.sn-menu .sn-menu-link-warn').count()) conAvviso.push(veri[i]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(conAvviso).toEqual([]);
});
