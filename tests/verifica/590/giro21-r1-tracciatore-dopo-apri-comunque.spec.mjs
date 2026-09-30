// Verifica #590 giro 21, rilievo 1: il sì di «Apri comunque» su un sito delle liste di pubblicità e
// tracciamento serve ad arrivare dove porta il link, non spegne quel tracciatore sulle pagine dopo.
import { test, expect, lista, apri } from '../../helpers/reteFinta.mjs';

// Una richiesta al tracciatore e una a un sito qualunque (il controllo: la rete della pagina funziona).
const spie = `<script>
  const prova = (u, k) => fetch(u, { mode: 'no-cors' }).then(() => { window[k] = 'caricato'; }, () => { window[k] = 'bloccato'; });
  prova('http://tracker.test/s.js', '__tracker'); prova('http://libero.test/s.js', '__libero');
</script>`;
const esito = (p) => p.evaluate(() => ({ tracker: window.__tracker, libero: window.__libero }));

test('dopo «Apri comunque» su un contatore di clic, l\'articolo e le pagine dopo nella stessa scheda bloccano ancora quel tracciatore', async ({ app, shell, rete }) => {
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  await lista(shell, [], { useAdblockLists: true });
  rete.pagina('tracker.test', '/s.js', 'x');
  rete.pagina('libero.test', '/s.js', 'x');
  const altro = rete.pagina('sito.test', '/altro', `<h1>ALTRO SITO</h1>${spie}`);
  const articolo = rete.pagina('articolo.test', '/', `<h1>ARTICOLO</h1>${spie}<a id="oltre" href="${altro}">oltre</a>`);
  const contatore = rete.rimbalzo('tracker.test', '/c', articolo);
  const giornale = rete.pagina('sito.test', '/', `<h1>GIORNALE</h1><a id="go" href="${contatore}">leggi</a>`);
  await apri(app, shell, giornale);
  const tab = app.windows().find((w) => w.url() === giornale);
  await tab.evaluate(() => document.getElementById('go').click());
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();

  // L'articolo arriva, ed è quello che l'utente voleva.
  await expect.poll(() => app.windows().some((w) => w.url() === articolo), { timeout: 8000 }).toBe(true);
  const scheda = app.windows().find((w) => w.url() === articolo);
  await expect(scheda.locator('h1')).toHaveText('ARTICOLO');
  await expect.poll(() => esito(scheda), { timeout: 5000 }).toEqual({ tracker: 'bloccato', libero: 'caricato' });

  // Un altro sito nella stessa scheda: il tracciatore resta bloccato come in ogni altra scheda.
  await scheda.evaluate(() => document.getElementById('oltre').click());
  await expect.poll(() => scheda.url(), { timeout: 8000 }).toBe(altro);
  await expect.poll(() => esito(scheda), { timeout: 5000 }).toEqual({ tracker: 'bloccato', libero: 'caricato' });
});
