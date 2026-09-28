// Giro 14, rilievo 1: una finestrella «di accesso» aperta dalla pagina porta sul sito della lista.
import { test, expect, lista, finestre, apri, contaAvvisi } from './helpers/banco.mjs';

test('la pagina apre da sola una finestrella di accesso verso il sito della lista: non si apre, e lo si dice', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const accesso = rete.pagina('blocked.test', '/dialog', '<h1>SITO DELLA LISTA</h1>') + '?client_id=x&response_type=code&redirect_uri=y';
  const pagina = rete.pagina('sito.test', '/', `<h1>pagina</h1><script>setTimeout(() => window.open(${JSON.stringify(accesso)}, 'accesso', 'width=500,height=400'), 300)</script>`);
  await apri(app, shell, pagina);
  await shell.waitForTimeout(2500);
  expect((await finestre(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});
