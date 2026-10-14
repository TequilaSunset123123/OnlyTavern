// SillyTavern side of CreatorSim: a button in the extensions menu that opens the
// React app (dist/index.html) in a full-screen same-origin iframe. Closing only
// hides the iframe, so the app keeps its state until the page reloads.
//
// The iframe sits in a modal <dialog>: SillyTavern puts a transform on <html>,
// which breaks position:fixed (it scrolls with the page). The dialog's top layer
// is always relative to the viewport.

const APP_URL = new URL('./dist/index.html', import.meta.url);
const OVERLAY_ID = 'creatorsim-overlay';

function getOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('dialog');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;'
        + 'margin:0;padding:0;border:0;background:#0a0a0a;';

    const iframe = document.createElement('iframe');
    iframe.title = 'CreatorSim';
    iframe.src = `${APP_URL.href}?v=${Date.now()}`; // index.html is not hashed; assets are
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    overlay.appendChild(iframe);

    document.body.appendChild(overlay);
    return overlay;
}

function openApp() {
    const overlay = getOverlay();
    if (!overlay.open) overlay.showModal();
}

function closeApp() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay?.open) overlay.close();
}

// Adapted from SillyTavern-Chess addLaunchButton().
function addLaunchButton() {
    const launchButton = document.createElement('div');
    launchButton.id = 'creatorsim-launch';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = 'Open CreatorSim';
    const icon = document.createElement('i');
    icon.classList.add('fa-solid', 'fa-camera-retro');
    launchButton.appendChild(icon);
    const text = document.createElement('span');
    text.textContent = 'CreatorSim';
    launchButton.appendChild(text);

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        throw new Error('Could not find the extensions menu');
    }

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', openApp);
}

(function () {
    addLaunchButton();

    // The app asks to be closed via postMessage (app/src/bridge/st.ts).
    window.addEventListener('message', (event) => {
        if (event.origin === window.location.origin && event.data?.type === 'creatorsim:close') {
            closeApp();
        }
    });
})();
