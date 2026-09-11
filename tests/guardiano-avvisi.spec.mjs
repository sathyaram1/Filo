// #536 — il guardiano degli avvisi, dal finto Gmail fino alla colonna della home.
//
// COSA PROVA, dal punto di vista di chi usa Filo:
//   1. una mail che imita la banca NON diventa un avviso: al suo posto compare
//      una riga che dice cosa è stato fermato e da chi veniva;
//   2. una mail normale diventa un avviso, col mittente scritto accanto e i
//      collegamenti che mostrano dove portano davvero;
//   3. col guardiano irraggiungibile l'avviso NON compare e NON si perde: resta
//      in attesa, visibile, e compare appena il guardiano torna.
//
// Il giro di lettura della posta non c'è ancora (arriva col suo feedback):
// qui la posta è una pagina vera servita dal mini server e il testo dell'avviso
// viene LETTO DA QUELLA PAGINA, come farà il giro vero. Quello che si prova è
// la parte che questo feedback costruisce: il punto di passaggio unico, il
// blocco, la coda, e cosa finisce davanti all'utente.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

// Il finto Gmail: due mail, una che imita la banca e una qualunque.
const POSTA = `<!doctype html><meta charset="utf-8"><title>Posta</title>
<div class="thread" data-from="Banca Esempio &lt;sicurezza@banca-esempio.it.attacco.ru&gt;">
  <h2 class="subj">Conferma urgente del tuo conto</h2>
  <div class="body">Gentile cliente, il suo conto verra bloccato entro 24 ore.
Confermi subito le credenziali: <a href="https://banca-esempio.it.attacco.ru/login">banca-esempio.it</a></div>
</div>
<div class="thread" data-from="Marco Bianchi &lt;marco@esempio.it&gt;">
  <h2 class="subj">Foto del weekend</h2>
  <div class="body">Ciao! Ho caricato le foto qui: <a href="https://album.esempio.it/weekend">album.esempio.it</a></div>
</div>`;

async function homePage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'la home non si è aperta entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// Legge una mail dal finto Gmail e ne ricava l'avviso che un modello scriverebbe
// dopo averla letta: esattamente il testo che deve passare dal guardiano.
async function avvisoDallaPosta(posta, indice) {
  return posta.evaluate((i) => {
    const t = document.querySelectorAll('.thread')[i];
    const mittente = t.dataset.from;
    const oggetto = t.querySelector('.subj').textContent.trim();
    const link = t.querySelector('.body a');
    return {
      mittente,
      // Il modello riassume e riporta il collegamento COSÌ COM'ERA nella mail:
      // etichetta che sembra la banca, destinazione che non lo è.
      testo: `${oggetto}. [${link.textContent}](${link.getAttribute('href')})`,
    };
  }, indice);
}

// Propone l'avviso come farebbe un'automazione che ha letto la posta. Passa dal
// punto di passaggio unico, che è l'unica strada per far comparire una notifica.
async function proponi(app, { testo, mittente, rispostaGuardiano, guardianoGiu }) {
  return app.evaluate(async (_electron, arg) => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    TG.configure({
      pausaMs: 0,
      eseguiModello: arg.guardianoGiu
        ? async () => { throw new Error('fornitore non raggiungibile'); }
        : async () => arg.rispostaGuardiano,
    });
    return TG.proponiNotifica({
      testo: arg.testo,
      kind: 'alert',
      fiducia: 'contaminato',
      origine: `una mail di ${arg.mittente}`,
      regolaAutomazione: 'avvisami delle mail importanti',
      produttore: 'deepseek, gemma',
    });
  }, { testo, mittente, rispostaGuardiano, guardianoGiu });
}

test('una mail che imita la banca non diventa un avviso: al suo posto la riga del blocco', async ({ app, openTab, testServer }) => {
  const home = await homePage(app);
  const posta = await openTab(testServer.html(POSTA));
  const mail = await avvisoDallaPosta(posta, 0);

  // Il guardiano direbbe «passa»: a fermarla è il controllo STATICO, che vede
  // un collegamento la cui destinazione non è quella che l'etichetta promette.
  // Così la prova vale anche a rete staccata.
  const esito = await proponi(app, {
    testo: mail.testo, mittente: mail.mittente, rispostaGuardiano: '{"esito":"passa"}',
  });
  expect(esito.esito).toBe('blocca');

  const carte = home.locator('.dash-live-card');
  await expect(carte.first()).toBeVisible({ timeout: 8_000 });
  const riga = home.locator('.dash-live-card[data-guardiano="blocco"]');
  await expect(riga).toHaveCount(1, { timeout: 8_000 });
  await expect(riga).toContainText('Ho fermato un avviso nato da una mail di Banca Esempio');
  // Blocca e SPIEGA cosa ha visto, non che ha avuto un dubbio.
  await expect(riga).toContainText('collegamento');
  // L'avviso pericoloso non è arrivato da nessuna parte.
  await expect(home.locator('.dash-live-card')).not.toContainText('Conferma urgente del tuo conto');
  await expect(home.locator('.dash-live-card')).not.toContainText('attacco.ru/login');

  // E il blocco resta scritto nel registro che l'utente legge in Preferenze.
  const registro = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listGuardBlocks());
  expect(registro.length).toBe(1);
  expect(registro[0].origine).toContain('Banca Esempio');
  expect(registro[0].regola).toBe('link-ingannevole');
});

test('una mail normale diventa un avviso, col mittente e la destinazione vera del link', async ({ app, openTab, testServer }) => {
  const home = await homePage(app);
  const posta = await openTab(testServer.html(POSTA));
  const mail = await avvisoDallaPosta(posta, 1);

  const esito = await proponi(app, {
    testo: mail.testo, mittente: mail.mittente, rispostaGuardiano: '{"esito":"passa"}',
  });
  expect(esito.esito).toBe('passa');

  const carta = home.locator('.dash-live-card[data-guardiano="passato"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await expect(carta).toContainText('Foto del weekend');
  // Da chi viene: l'utente deve sapere di chi si sta fidando.
  await expect(carta.locator('.dash-live-origin')).toContainText('Marco Bianchi');
  // Dove porta davvero il collegamento: qui l'etichetta È già il dominio, e si
  // legge sulla carta; l'indirizzo completo è quello del link, non un altro.
  await expect(carta).toContainText('album.esempio.it');
  await expect(carta.locator('a.dash-live-link')).toHaveAttribute('href', 'https://album.esempio.it/weekend');

  // Quando invece l'etichetta è una frase («apri le foto») il dominio non si
  // vedrebbe: allora viene scritto accanto. È il caso che conta davvero, perché
  // è la forma con cui un link travestito arriva all'utente.
  await app.evaluate(async () => globalThis.SN_TEXT_GUARDIAN.proponiNotifica({
    testo: 'Marco ha caricato le foto: [apri le foto](https://album.esempio.it/weekend)',
    kind: 'info',
    fiducia: 'contaminato',
    origine: 'una mail di Marco Bianchi',
  }));
  const conFrase = home.locator('.dash-live-card', { hasText: 'apri le foto' });
  await expect(conFrase.locator('.dash-live-dest')).toHaveText('(album.esempio.it)', { timeout: 8_000 });
});

test('col guardiano irraggiungibile l’avviso aspetta, e compare quando torna', async ({ app, openTab, testServer }) => {
  const home = await homePage(app);
  const posta = await openTab(testServer.html(POSTA));
  const mail = await avvisoDallaPosta(posta, 1);

  const esito = await proponi(app, {
    testo: mail.testo, mittente: mail.mittente, guardianoGiu: true,
  });
  expect(esito.esito).toBe('in-attesa');

  // Non compare, e si vede che sta aspettando.
  const attesa = home.locator('.dash-live-card[data-guardiano="attesa"]');
  await expect(attesa).toHaveCount(1, { timeout: 8_000 });
  await expect(attesa).toContainText('aspetta il controllo');
  await expect(home.locator('.dash-live-card')).not.toContainText('Foto del weekend');
  // Si può anche togliere: un avviso in attesa non è una riga inamovibile.
  await expect(attesa.locator('.dash-live-dismiss')).toHaveCount(1);

  // Il guardiano torna: l'avviso arriva, per intero, e l'attesa sparisce.
  await app.evaluate(async () => {
    globalThis.SN_TEXT_GUARDIAN.configure({
      pausaMs: 0,
      eseguiModello: async () => '{"esito":"passa"}',
    });
    return globalThis.SN_TEXT_GUARDIAN.riprendiInAttesa();
  });
  const carta = home.locator('.dash-live-card[data-guardiano="passato"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await expect(carta).toContainText('Foto del weekend');
  await expect(home.locator('.dash-live-card[data-guardiano="attesa"]')).toHaveCount(0);
});

test('il registro degli avvisi fermati si legge, e si svuota, dalle Preferenze', async ({ app, openTab, testServer }) => {
  await homePage(app);
  const posta = await openTab(testServer.html(POSTA));
  const mail = await avvisoDallaPosta(posta, 0);
  await proponi(app, {
    testo: mail.testo, mittente: mail.mittente, rispostaGuardiano: '{"esito":"passa"}',
  });

  const pref = await openTab('filo://preferences/preferences.html');
  const voci = pref.locator('#guardBlocksList .guard-item');
  await expect(voci).toHaveCount(1, { timeout: 8_000 });
  await expect(voci.first()).toContainText('collegamento');
  await expect(voci.first().locator('.guard-meta')).toContainText('Banca Esempio');

  // Il testo fermato si può leggere — è l'unico modo di capire se il guardiano
  // grida al lupo — ma parte chiuso e non è cliccabile.
  const testo = voci.first().locator('.guard-text');
  await expect(testo).toBeHidden();
  await voci.first().locator('.guard-toggle').click();
  await expect(testo).toBeVisible();
  await expect(testo).toContainText('attacco.ru');
  await expect(testo.locator('a')).toHaveCount(0);

  // Se si può aggiungere si può togliere. E siccome togliere qui vuol dire
  // buttare la sola prova che il guardiano stia sbagliando, prima si chiede.
  await pref.locator('#clearGuardBlocks').click();
  expect(await confirmText(pref)).toContain('non si può annullare');
  await clickConfirm(pref, 'cancel');
  await expect(voci).toHaveCount(1, 'annullare non deve cancellare niente');

  await pref.locator('#clearGuardBlocks').click();
  await clickConfirm(pref, 'ok');
  await expect(voci).toHaveCount(0, { timeout: 8_000 });
  await expect(pref.locator('#guardBlocksEmpty')).toBeVisible();
});
