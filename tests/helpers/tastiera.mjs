// Scrive come la tastiera italiana dell'utente: anche le lettere accentate col loro tasto (un keydown col carattere).
// keyboard.type di Playwright le manda senza tasto, come farebbe uno script, e il correttore controlla e corregge solo il
// testo battuto (#2299, patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md).
export async function batti(page, testo, { delay = 0 } = {}) {
  let s = null;
  try {
    for (const c of testo) {
      if (/^[\x20-\x7e\n]$/.test(c)) await page.keyboard.type(c);
      else {
        s ||= await page.context().newCDPSession(page);
        await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, unmodifiedText: c });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: c });
      }
      if (delay) await page.waitForTimeout(delay);
    }
  } finally {
    if (s) await s.detach().catch(() => {});
  }
}
