import { test } from '../../fixtures/electron.mjs';

test('profilo incolla', async ({ openTab }) => {
  test.setTimeout(170_000);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  const cdp = await editor.context().newCDPSession(editor).catch(() => null);
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const out = await editor.evaluate(async () => {
    const d = document.getElementById('doc');
    d.focus();
    const testo = Array.from({ length: 300 }, (_, i) => `Riga ${i}: caldaia.`).join('\n');
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    const t0 = performance.now();
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const sync = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    const dopo = performance.now() - t0;
    return { sync: Math.round(sync), dopo: Math.round(dopo), p: d.querySelectorAll('p').length };
  });
  console.log(JSON.stringify(out));
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`).join('\n'));
  }
});
