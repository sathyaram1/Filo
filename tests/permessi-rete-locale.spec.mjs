// La domanda per la rete locale (#1068): da Electron 44 un sito può chiedere di collegarsi agli apparecchi della rete
// di casa, e la cornice lo dice con le sue parole, non con quelle del microfono. Regole: src/main/services/permessiPagine.js.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const barra = (shell) => shell.locator('#permesso-bar');

async function chiediRete(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const host = 'router.example';
    w.webContents.send('tabs:permesso', {
      id: 'prova-rete', tabId: w._filoTabs.activeId, host, sotto: '', dominio: host, tipo: 'rete', parti: ['rete'],
    });
  });
}

test('un sito che chiede la rete locale si vede chiedere proprio quella, col suo nome', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Router</title><p>pannello</p>');
  await chiediRete(app);
  await expect(barra(shell)).toBeVisible({ timeout: 10_000 });
  await expect(barra(shell)).toContainText('router.example');
  await expect(barra(shell)).toContainText('vuole collegarsi agli apparecchi della tua rete');
  await expect(barra(shell)).not.toContainText('microfono');
  mkdirSync('tests/.shots', { recursive: true });
  await shell.screenshot({ path: 'tests/.shots/1068-permesso-rete-chiaro.png' });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.screenshot({ path: 'tests/.shots/1068-permesso-rete-scuro.png' });
  await shell.emulateMedia({ colorScheme: 'light' });
});
