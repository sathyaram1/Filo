import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // First dismiss consent if present
      const consentBtn = document.querySelector('button[aria-label*="Accept"], button[aria-label*="Accetta"], tp-yt-paper-button.style-scope.ytd-consent-bump-v2-lightbox');
      if (consentBtn) consentBtn.click();

      // Check if init() completed by checking if contextmenu listener exists
      // Inject a test via a direct call to SN_MENU.open
      let directOpenWorks = false;
      try {
        SN_MENU.open({ x: 100, y: 100, items: [{ type: 'item', label: 'Test' }] });
        const m = document.querySelector('.sn-menu');
        directOpenWorks = !!m;
        if (m) SN_MENU.close();
      } catch(e) {
        directOpenWorks = 'error: ' + e.message;
      }

      // Now try dispatching contextmenu on a real element
      return new Promise(resolve => {
        setTimeout(() => {
          const target = document.querySelector('#content') || document.querySelector('ytd-app') || document.body;
          const evt = new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, view: window,
            clientX: 400, clientY: 300, button: 2,
          });
          target.dispatchEvent(evt);
          
          setTimeout(() => {
            const menu = document.querySelector('.sn-menu');
            resolve({
              directOpenWorks,
              consentFound: !!consentBtn,
              menuAfterDispatch: !!menu,
              menuZIndex: menu ? getComputedStyle(menu).zIndex : null,
              allMenus: document.querySelectorAll('.sn-menu').length,
            });
          }, 500);
        }, 1000); // wait for consent dismiss
      });
    });
    console.log('YOUTUBE v3:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
