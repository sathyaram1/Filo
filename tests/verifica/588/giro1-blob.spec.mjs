// Verifica #588, giro 1 — il programma che il sito costruisce nella pagina.
//
// Un sito non è obbligato a servire il programma da un indirizzo: può fabbricarlo
// nella pagina (blob:) o incollarlo dentro il link (data:) e farlo scaricare con
// un clic. È la stessa cosa per l'utente — clicca "Scarica" e si ritrova un .exe —
// quindi deve fermarsi alla stessa domanda, e la domanda deve dire da dove arriva.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, readdirSync } from 'node:fs';

const elenco = async (shell) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (r && r.items) || [];
};
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

const PAGINA = `<!doctype html><html><body style="padding:40px">
<button id="blob">blob</button>
<button id="data">data</button>
<script>
  function scarica(href, nome) {
    const a = document.createElement('a');
    a.href = href; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }
  document.getElementById('blob').onclick = () => {
    const b = new Blob([new Uint8Array([77, 90, 1, 2, 3, 4, 5, 6])], { type: 'application/octet-stream' });
    scarica(URL.createObjectURL(b), 'daBlob.exe');
  };
  document.getElementById('data').onclick = () => {
    scarica('data:application/octet-stream;base64,TVoBAgMEBQY=', 'daData.exe');
  };
</script></body></html>`;

test('un programma fabbricato dalla pagina si ferma come gli altri, e dice da dove arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  const origine = new URL(page.url()).hostname;

  const mancanti = [];
  for (const [bottone, nome] of [['blob', 'daBlob.exe'], ['data', 'daData.exe']]) {
    await page.locator(`#${bottone}`).click();
    // 1) La domanda arriva: un programma non entra nella cartella da solo,
    //    qualunque strada abbia preso il sito per consegnarlo.
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === nome)?.state,
      { timeout: 30000 }, `«${nome}» non si è fermato`).toBe('pending');
    expect(contenuto(dir), `«${nome}» è finito in cartella senza risposta`).not.toContain(nome);

    const rec = (await elenco(shell)).find((r) => r.filename === nome);
    expect(rec.exe).toBe(true);

    // 2) E dice da quale sito arriva: è la cosa su cui l'utente decide, e il
    //    sito non deve poterla togliere scegliendo come consegnare il file.
    const avviso = shell.locator('.shell-notif', { hasText: nome });
    await expect(avviso).toBeVisible({ timeout: 15000 });
    await expect(avviso).toContainText('programma');
    mancanti.push([nome, rec.site]);

    await shell.evaluate((id) => window.filoShell.downloads.confirm(id, false), rec.id);
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === nome)?.state,
      { timeout: 20000 }).toBe('cancelled');
  }

  expect(contenuto(dir)).toEqual([]);
  for (const [nome, sito] of mancanti) {
    expect(sito, `«${nome}»: la domanda non nomina il sito`).toBe(origine);
  }
});
