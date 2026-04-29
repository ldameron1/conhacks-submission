const { firefox } = require('playwright');
(async () => {
  const browser = await firefox.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  await page.goto('http://localhost:8080');
  
  await page.evaluate(() => {
    try {
      const p = new Cesium.UrlTemplateImageryProvider({url: "..."});
      const v = new Cesium.Viewer(document.createElement('div'), {
        baseLayer: new Cesium.ImageryLayer(p),
        baseLayerPicker: false
      });
      console.log('Cesium viewer created with baseLayer');
    } catch(e) {
      console.log('Error:', e.message);
    }
  });
  await browser.close();
})();
