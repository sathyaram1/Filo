// #1606 — Filo resta acceso senza la finestra principale quando la si chiude con la finestrella di accesso aperta.
// Riaprirlo (collegamento, o un link d'invito da fuori) deve rifare la finestra con le sue schede, non andare in errore.
// Regola: mostraFinestraNormale in src/main/window.js; la logica è provata anche in tests/unit/secondaApertura.test.mjs.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';

// La pagina di accesso la serve Filo stesso: niente rete, e i verdetti sui siti restano fuori.
async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x';
const NEGOZIO = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
  onclick="window.open(${JSON.stringify(GOOGLE).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi con Google</button>`;

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normale = vive.find((w) => w._filoTabs && !w._filoIncognito);
  return {
    accesso: vive.filter((w) => !w._filoTabs && /^https:\/\/accounts\.google\.com\//.test(w.webContents.getURL())).length,
    normale: normale ? {
      visibile: normale.isVisible(),
      // Una scheda riaperta che aspetta il suo turno non ha ancora un indirizzo caricato: vale quello che aspetta.
      schede: normale._filoTabs.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } }),
    } : null,
  };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

// I passi della segnalazione fino a Filo acceso senza finestra principale: la finestrella di accesso lo tiene in vita.
async function chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer) {
  await servi(app, { 'accounts.google.com/o/oauth2/v2/auth': '<title>Accedi - Account Google</title><h1>Passkey</h1>' });
  const page = await testServer.openReady(openTab, NEGOZIO);
  const negozio = page.url();
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).accesso, { message: 'la finestrella di accesso non si è aperta', timeout: 10000 }).toBe(1);
  // Chi aspetta la passkey ci mette più di quanto Filo impiega a scrivere le schede: la prova aspetta lo stesso.
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede aperte non sono state salvate', timeout: 10000 }).toContain(negozio);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app)).normale, { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
  expect((await stato(app)).accesso, 'chiusa la principale, la finestrella resta e tiene acceso Filo').toBe(1);
  return negozio;
}

test('riaperto dal collegamento, Filo rifà la finestra con le sue schede e la finestrella resta', async ({ app, shell, openTab, testServer }) => {
  const negozio = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  // Come arriva su Windows e Linux la seconda apertura dal collegamento: senza indirizzi fra gli argomenti.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); });
  await expect.poll(async () => (await stato(app)).normale?.schede || [], { message: 'riaperto Filo, la scheda del negozio non è tornata', timeout: 15000 })
    .toContain(negozio);
  const dopo = await stato(app);
  expect(dopo.normale.visibile, 'la finestra rifatta deve vedersi').toBe(true);
  expect(dopo.accesso, 'la finestrella di accesso non si chiude per questo').toBe(1);

  // Una terza apertura con la finestra già lì la porta davanti e basta: niente doppioni.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && w._filoTabs && !w._filoIncognito).length)).toBe(1);
});

test('un link d\'invito aperto da fuori con Filo senza finestra apre Crediti, da tutte e due le strade', async ({ app, shell, openTab, testServer }) => {
  await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  // Windows e Linux: il link arriva fra gli argomenti della seconda apertura. Il codice storto non chiede niente al
  // server, e la pagina dice perché: basta a vedere che Crediti si è aperta in una finestra viva.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await stato(app)).normale?.schede || [], { message: 'l\'invito non ha aperto Crediti', timeout: 15000 })
    .toContainEqual(expect.stringMatching(/^filo:\/\/credits\//));
  const crediti = await aspettaFinestra(app, (w) => w.url().startsWith('filo://credits/'), 'la pagina Crediti non è nata');
  await expect(crediti.locator('#walletNote')).toContainText('otto caratteri', { timeout: 15000 });

  // Mac: chiusa la finestra Filo resta acceso, e il link arriva con open-url: stessa strada, stesso esito.
  const barra = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la barra della finestra rifatta non c\'è');
  await barra.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app)).normale, { timeout: 10000 }).toBeNull();
  await app.evaluate(({ app: a }) => { a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await expect.poll(async () => (await stato(app)).normale?.schede || [], { message: 'su Mac l\'invito non ha aperto Crediti', timeout: 15000 })
    .toContainEqual(expect.stringMatching(/^filo:\/\/credits\//));
});
