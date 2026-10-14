// SillyTavern side of OnlyTavern: a button in the extensions menu that opens the
// React app (dist/index.html) in a full-screen same-origin iframe. Closing only
// hides the iframe, so the app keeps its state until the page reloads.
//
// The iframe sits in a modal <dialog>: SillyTavern puts a transform on <html>,
// which breaks position:fixed (it scrolls with the page). The dialog's top layer
// is always relative to the viewport.

const APP_URL = new URL('./dist/index.html', import.meta.url);
const OVERLAY_ID = 'onlytavern-overlay';

function getOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('dialog');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;'
        + 'margin:0;padding:0;border:0;background:#0a0a0a;';

    const iframe = document.createElement('iframe');
    iframe.title = 'OnlyTavern';
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
    launchButton.id = 'onlytavern-launch';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = 'Open OnlyTavern';
    const icon = document.createElement('i');
    icon.classList.add('fa-solid', 'fa-camera-retro');
    launchButton.appendChild(icon);
    const text = document.createElement('span');
    text.textContent = 'OnlyTavern';
    launchButton.appendChild(text);

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        throw new Error('Could not find the extensions menu');
    }

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', openApp);
}

// A block in the Extensions panel, so the extension is visible there too.
function addSettingsBlock() {
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'onlytavern-settings';
    block.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>OnlyTavern</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p>A creator-platform simulator. Also available from the extensions (wand) menu.</p>
                <div class="menu_button menu_button_icon" id="onlytavern-open">
                    <i class="fa-solid fa-camera-retro"></i>
                    <span>Open OnlyTavern</span>
                </div>
            </div>
        </div>`;
    container.appendChild(block);
    block.querySelector('#onlytavern-open').addEventListener('click', openApp);
}

(function () {
    addLaunchButton();
    addSettingsBlock();

    // The app asks to be closed via postMessage (app/src/bridge/st.ts).
    window.addEventListener('message', (event) => {
        if (event.origin === window.location.origin && event.data?.type === 'onlytavern:close') {
            closeApp();
        }
    });
})();
