// #2087 — il tasto destro sulla linguetta: niente «Aiuto», e i permessi ricordati per il sito una riga ciascuno. Il clic
// su una riga toglie quella scelta sola, le altre restano, e al menu dopo la riga non c'è più. La strada per la domanda
// «chiedi» sull'avviso del sito la provano tests/safebrowse.spec.mjs (tasto destro sull'avviso, Alt+H).
import { test, expect } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, apriEAspetta, fotoDelMenu } from './helpers/menuLinguetta.mjs';

// Le risposte ricordate per un sito, scritte dove Filo le tiene e rilette da lì, come all'avvio.
async function ricorda(app, scelte) {
  await app.evaluate(async (_m, scelte) => {
    const rq = process.mainModule.require;
    const p = rq('node:path');
    const disco = rq(p.join(process.cwd(), 'src/main/shim/storage.js'));
    await disco.set({ sitePermissions: scelte });
    await rq(p.join(process.cwd(), 'src/main/services/permessiPagine.js')).carica();
  }, scelte);
}

// «Resta connesso qui» dipende dalla privacy di serie, non da questo lavoro: le prove guardano il resto, e il suo posto.
const CONNESSO = /^(Resta connesso qui|Non restare connesso)$/;
const senzaConnesso = (voci) => voci.map((x) => x.testo).filter((t) => !CONNESSO.test(t));

const ricordate = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.message({ type: 'permessi_siti_get' });
  return (r && r.scelte ? r.scelte : []).map((s) => `${s.parte}:${s.si}`).sort();
});

test('scheda di un sito senza permessi ricordati: niente Aiuto, nessuna riga dei permessi', async ({ app, shell, testServer }) => {
  const id = await apriEAspetta(app, testServer.html('<title>Uno</title><p>uno'));
  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  const testi = senzaConnesso(voci);
  expect(testi).toEqual(['Blocca', 'Duplica', 'Muta', 'Chiudi']);
  expect(voci.some((x) => x.hover)).toBe(false);
});

test('microfono consentito e notifiche negate: due righe, il clic su una toglie solo quella', async ({ app, shell, testServer }) => {
  const url = testServer.html('<title>Riunione</title><p>stanza');
  const origine = new URL(url).origin;
  await ricorda(app, { [`${origine}|audio`]: true, [`${origine}|notifiche`]: false, 'https://altro.example|video': true });
  const id = await apriEAspetta(app, url);

  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(senzaConnesso(voci)).toEqual(['Blocca', 'Duplica', 'Muta', 'Microfono: consentito', 'Notifiche: negate', 'Chiudi']);
  const tutte = voci.map((x) => x.testo);
  const connesso = tutte.findIndex((t) => CONNESSO.test(t));
  if (connesso >= 0) expect(connesso).toBeLessThan(tutte.indexOf('Microfono: consentito'));
  expect(voci.filter((x) => x.hover).map((x) => x.hover)).toEqual(['Togli', 'Togli']);
  expect(voci.find((x) => x.testo === 'Microfono: consentito').icona).toBe(true);
  await fotoDelMenu(app, 'tests/.shots/menu-linguetta-permessi.png');
  await scegli(app, 'Notifiche: negate');

  await expect.poll(() => ricordate(shell), { timeout: 8_000 }).toEqual(['audio:true', 'video:true']);
  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  const dopo = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica') && !v.some((x) => x.testo === 'Notifiche: negate'));
  expect(senzaConnesso(dopo)).toEqual(['Blocca', 'Duplica', 'Muta', 'Microfono: consentito', 'Chiudi']);
});
