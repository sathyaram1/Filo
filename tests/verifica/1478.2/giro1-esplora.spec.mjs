// Esplorazione del giro 1 di #1478.2: chiusure in fretta e pila aperta con dieci avvisi di popup bloccati.
import { test, expect } from '../../fixtures/electron.mjs';

const raffica = (testServer, quando, n, titolo) => testServer.html(`<title>${titolo}</title><p>articolo</p><script>
  setTimeout(function(){for(var i=0;i<${n};i++)window.open('${testServer.html('<title>PUBBLICITA</title>')}?ad='+i)}, Math.max(300, ${quando}-Date.now()));
</script>`);

async function dieci(shell, testServer, avvisi) {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  const quando = Date.now() + 6000;
  for (let i = 0; i < 10; i++) await shell.evaluate((u) => window.filoShell.tabs.open(u), raffica(testServer, quando, 8, `Sito ${i}`));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toHaveCount(5, { timeout: 15000 });
  await expect(vista.locator('.avvisi-testa [data-pila="apri"]')).toHaveText('+5 avvisi', { timeout: 15000 });
  return vista;
}

test('chiusure in fretta: cinque X di fila senza aspettare, entrano le cinque in coda', async ({ shell, testServer, avvisi }) => {
  const vista = await dieci(shell, testServer, avvisi);
  for (let k = 0; k < 5; k++) {
    const x = vista.locator('.shell-notif.show:not([data-closing="1"]) .shell-notif-close').first();
    await x.click({ timeout: 2000 }).catch(() => {});
  }
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(5, { timeout: 6000 });
  await expect(vista.locator('.shell-notif.show')).toHaveCount(5, { timeout: 6000 });
  await expect(vista.locator('.avvisi-testa')).toBeHidden();
});

test('«+5» mostra tutti e dieci, e da lì si chiudono uno a uno fino a zero', async ({ shell, testServer, avvisi }) => {
  const vista = await dieci(shell, testServer, avvisi);
  await vista.locator('.avvisi-testa [data-pila="apri"]').click();
  await expect(vista.locator('.shell-notif')).toHaveCount(10);
  for (let resto = 10; resto > 0; resto--) {
    const nid = await vista.locator('.shell-notif.show').first().getAttribute('data-nid');
    const x = vista.locator(`.shell-notif[data-nid="${nid}"] .shell-notif-close`);
    await x.scrollIntoViewIfNeeded();
    await x.click();
    await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(resto - 1, { timeout: 4000 });
    await expect(vista.locator(`.shell-notif.show[data-nid="${nid}"]`)).toHaveCount(0, { timeout: 4000 });
  }
  await vista.screenshot({ path: 'tests/.shots/1478.2-vuota.png' }).catch(() => {});
});
