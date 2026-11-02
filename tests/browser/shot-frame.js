/* Shows one harness scenario at popup size, for tests/browser/screenshots.js */
(() => {

    const oParams = new URLSearchParams(window.location.search);
    const oFrame = document.createElement('iframe');

    oFrame.width = oParams.get('w');
    oFrame.height = oParams.get('h');
    oFrame.src = `popup-harness.html?scenario=${encodeURIComponent(oParams.get('scenario'))}`;
    document.body.appendChild(oFrame);
})();
