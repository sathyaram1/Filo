import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // Check if contextmenu listener is actually registered by trying to trigger it
      const errors = [];
      let handlerCalled = false;
      
      // Check if SN_MENU.open exists and works
      const menuOpenExists = typeof window.SN_MENU?.open === 'function';
      
      // Check if the blocked check passes
      const SN_CONST = window.SN_CONST;
      const blocked = SN_CONST?.PAGES_WITHOUT_MENU_PREFIXES?.some(p => location.href.startsWith(p));
      
      // Check if chrome.runtime.sendMessage works
      let chromeWorks = false;
      try {
        const p = chrome.runtime.sendMessage({ type: 'get_settings' });
        chromeWorks = p instanceof Promise;
      } catch(e) {
        errors.push('chrome.sendMessage: ' + e.message);
      }

      // Try dispatching on different targets
      const targets = [
        { name: 'body', el: document.body },
        { name: 'html', el: document.documentElement },
        { name: 'ytd-app', el: document.querySelector('ytd-app') },
      ];
      
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 400, clientY: 400, button: 2,
      });
      // First try window directly
      window.dispatchEvent(evt);

      return new Promise(resolve => {
        setTimeout(() => {
          const menu = document.querySelector('.sn-menu');
          resolve({
            menuOpenExists,
            blocked,
            chromeWorks,
            errors,
            menuAfterWindowDispatch: !!menu,
            ytdApp: !!document.querySelector('ytd-app'),
            bodyChildren: document.body.children.length,
            // Check what's actually at 400,400
            elementAt400: (() => {
              const el = document.elementFromPoint(400, 400);
              return el ? el.tagName + '.' + el.className.toString().slice(0, 50) : 'null';
            })(),
          });
        }, 1000);
      });
    });
    console.log('YOUTUBE DEEP:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
