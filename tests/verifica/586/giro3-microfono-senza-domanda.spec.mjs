// Verifica #586, giro 3 — il microfono acceso da un sito senza nessuna domanda.
//
// Stessa causa degli appunti: le due cose che Filo chiede per conto proprio
// dentro una pagina (gli appunti dell'Incolla, il microfono della dettatura)
// saltano la domanda. Il menu di Filo però vive dentro la pagina, e il codice
// del sito lo apre e lo preme da solo.
//
// Per chi usa Filo: apri un sito qualunque, e quello accende il microfono. Non
// compare nessuna domanda, e nelle Impostazioni non c'è niente da revocare
// perché nessuna scelta è stata presa.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="50"></textarea>
<script>
  const accendi = async () => {
    const t = document.getElementById('ta');
    t.focus();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 }));
    await new Promise((r) => setTimeout(r, 600));
    const voci = [...document.querySelectorAll('button, .sn-menu-item, .sn-menu-row-btn')];
    const detta = voci.find((n) => /🎤/.test(n.textContent || ''));
    if (!detta) return { trovata: false };
    detta.click();
    await new Promise((r) => setTimeout(r, 2000));
    return { trovata: true };
  };
  window.__acceso = new Promise((r) => setTimeout(() => accendi().then(r, () => r({ trovata: false })), 400));
  // Subito dopo, il sito prova a prendersi il microfono per sé: la concessione
  // che Filo si è appena dato vale per la prima richiesta che arriva.
  window.__microfonoPerSe = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { const d = s.getTracks().map((x) => x.kind); try { s.getTracks().forEach((x) => x.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

test('un sito non deve poter accendere il microfono aprendo da solo il menu di Filo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  // Nessun gesto da fuori: parte da solo al caricamento.
  const esito = await page.evaluate(() => window.__acceso);
  console.log('[586 g3] dettatura fatta partire dal sito:', JSON.stringify(esito));
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g3] domande comparse:', domande);

  // La spia della dettatura in corso, dentro la pagina: è il segno che il
  // microfono è aperto.
  const spia = await page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((n) => typeof n.className === 'string' && /dictat|dettat|sn-rec/i.test(n.className))
    .map((n) => n.className).slice(0, 10));
  console.log('[586 g3] spie della dettatura nella pagina:', JSON.stringify(spia));

  expect(
    esito.trovata && spia.length > 0,
    'il sito ha fatto partire da solo la dettatura di Filo — microfono aperto — '
    + `senza che comparisse nessuna domanda (pastiglie comparse: ${domande})`,
  ).toBe(false);
});
