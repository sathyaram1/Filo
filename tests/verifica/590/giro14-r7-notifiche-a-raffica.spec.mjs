// Giro 14, rilievo 7: una pagina che insiste riempie l'angolo di notifiche identiche.
import { test, expect, lista, apri, contaAvvisi } from './helpers/banco.mjs';

test('una pagina che riprova ogni 150 ms non manda decine di notifiche', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>X</h1>');
  const pagina = rete.pagina('sito.test', '/', `<h1>insiste</h1><script>setInterval(() => { location.href = ${JSON.stringify(bersaglio)}; }, 150)</script>`);
  await apri(app, shell, pagina);
  await shell.waitForTimeout(5000);
  expect((await avvisi()).length).toBeLessThanOrEqual(3);
});
