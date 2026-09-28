// Giro 14, rilievo 2: l'eccezione «arrivo da una ricerca» la prende una pagina che non è una ricerca.
import { test, expect, lista, schede, apri } from './helpers/banco.mjs';

for (const [nome, host, path] of [
  ['un nome «searx» comprato su un\'estensione qualunque', 'searx.xyz', '/search'],
  ['una pagina pubblicata da chiunque su Google Sites', 'sites.google.com', '/view/pagina'],
  ['un articolo pubblicato da chiunque sul sottodominio di Baidu', 'baijiahao.baidu.com', '/s'],
]) {
  test(`${nome} non porta la scheda sul sito della lista`, async ({ app, shell, rete }) => {
    await lista(shell, ['blocked.test']);
    const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
    const partenza = rete.pagina(host, path, `<h1>pagina</h1><script>setTimeout(() => { location.href = ${JSON.stringify(bersaglio)}; }, 500)</script>`);
    await apri(app, shell, partenza);
    await shell.waitForTimeout(2500);
    expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  });
}
