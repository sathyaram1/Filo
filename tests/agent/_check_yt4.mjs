import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      return new Promise(resolve => {
        // Add our own test listener on window capture phase
        let testListenerCalled = false;
        window.addEventListener('contextmenu', () => { testListenerCalled = true; }, { capture: true, once: true });

        const target = document.querySelector('ytd-app') || document.body;
        const evt = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, view: window,
          clientX: 400, clientY: 300, button: 2,
        });
        target.dispatchEvent(evt);

        setTimeout(() => {
          resolve({
            testListenerCalled,
            menu: !!document.querySelector('.sn-menu'),
          });
        }, 500);
      });
    });
    console.log('YT LISTENER TEST:', JSON.stringify(result));

    // Now check if fetchSettings actually works on YouTube
    const result2 = await view.evaluate(() => {
      return new Promise(resolve => {
        const p = chrome.runtime.sendMessage({ type: 'get_settings' });
        const timeout = setTimeout(() => resolve({ settled: false, timedOut: true }), 5000);
        p.then(r => {
          clearTimeout(timeout);
          resolve({ settled: true, hasSettings: !!r?.settings, ok: r?.ok });
        }).catch(e => {
          clearTimeout(timeout);
          resolve({ settled: true, error: e.message });
        });
      });
    });
    console.log('YT SETTINGS:', JSON.stringify(result2));
  }
} finally {
  await d.closeFilo(app);
}
