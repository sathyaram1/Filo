// Esplorazione del riallineamento: dove l'aggiornamento finisce di scaricarsi convivono il contatore di main e il
// controllo del canale. Sullo stabile una patch scaricata si conta ma non diventa pronta; sul veloce sì, e si conta.

import { test, expect } from '../../fixtures/electron.mjs';

async function prova(app, canale, versione) {
  return app.evaluate(async (_e, { canale, versione }) => {
    const eventi = [];
    const C = globalThis.SN_CONTATORI_MAIN;
    const vero = C && C.aggiornamento;
    if (C) C.aggiornamento = (e) => { eventi.push(e); return vero && vero.call(C, e); };
    const ascolta = {};
    const u = {
      autoDownload: true, autoInstallOnAppQuit: false,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      removeListener(e, f) { ascolta[e] = (ascolta[e] || []).filter((x) => x !== f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() { return {}; },
      downloadUpdate() { return new Promise(() => {}); },
    };
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false, canale } });
    globalThis.__filoUpdater.seguiImpostazioni(await globalThis.SN_STORAGE.getSettings());
    await globalThis.__filoUpdater.avviaAggiornatore(u, { automatici: false, annuncia: () => {} });
    globalThis.__filoUpdater.seguiImpostazioni(await globalThis.SN_STORAGE.getSettings());
    u.emit('update-downloaded', { version: versione, downloadedFile: require('node:path').join(require('node:os').tmpdir(), 'nessuno', 'Filo.exe') });
    await new Promise((r) => setTimeout(r, 300));
    const s = globalThis.__filoUpdater.statoAggiornamento();
    return { eventi, fase: s && s.fase, pronta: s && (s.pronta || s.versione) };
  }, { canale, versione });
}

test('stabile: la patch scaricata si conta e non diventa pronta', async ({ app }) => {
  const r = await prova(app, 'stabile', '0.2.250');
  expect(r.eventi).toContain('scaricato');
  expect(r.fase).not.toBe('pronto');
});

test('veloce: la patch scaricata si conta e diventa pronta', async ({ app }) => {
  const r = await prova(app, 'veloce', '0.2.250');
  expect(r.eventi).toContain('scaricato');
  expect(r.fase).toBe('pronto');
});
