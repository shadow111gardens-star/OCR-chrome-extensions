# Quick OCR Snip

Quick OCR Snip is a Chrome Extension that lets you draw a snipping-tool-style rectangle on any webpage, runs OCR locally with Tesseract.js, and copies the extracted text to your clipboard.

No paid APIs are used. No CDN is used at runtime. Tesseract.js, the OCR worker, WebAssembly core, and English language model are bundled inside the extension.

## Install in Chrome

1. Download or keep the `quick-ocr-snip` folder on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the `quick-ocr-snip` folder.
6. Pin **Quick OCR Snip** from the Chrome extensions menu if you want fast toolbar access.

## How to use

1. Open any normal webpage, including YouTube.
2. Start the snip using either method:
   - Click the Quick OCR Snip extension icon.
   - Press `Ctrl+Shift+X` on Windows or `Cmd+Shift+X` on Mac.
3. The page dims and your cursor becomes a crosshair.
4. Click and drag over the text you want to capture.
5. Release the mouse button.
6. Wait for **Extracting text…**.
7. If text is found, it is copied silently and you will see **Text Copied!** for 2 seconds.

Press `Esc` at any time before releasing the mouse to cancel.

## Troubleshooting

### Nothing happens when I click the icon

Chrome blocks extensions on internal pages like `chrome://extensions`, the Chrome Web Store, and some browser settings pages. Try it on a normal website.

### The shortcut does not work

Go to `chrome://extensions/shortcuts` and check that **Quick OCR Snip** has `Ctrl+Shift+X` or `Cmd+Shift+X` assigned. Another extension or browser feature may already be using that shortcut.

### Clipboard copy fails

Chrome may require the page tab to be focused. Click the page once, then try the snip again. Also make sure the extension still has the `clipboardWrite` permission in `chrome://extensions`.

### OCR says no text detected

Try selecting a tighter area around the text. OCR works best with clear, high-contrast text that is not too small or heavily blurred.

### It feels slow the first time

The first OCR run loads the local Tesseract worker, WebAssembly file, and English model. Later runs are usually faster because Chrome can cache those files.

### YouTube or strict CSP pages

The extension uses Manifest V3 `chrome.scripting` injection and loads OCR files from the extension itself. The manifest also exposes the local OCR files through `web_accessible_resources`, so strict page CSP rules like YouTube's should not block the extension files.

## Add More OCR Languages Later

1. Download the Tesseract `.traineddata.gz` file for the language you want.
2. Put it in the `lang` folder next to `eng.traineddata.gz`.
3. Open `ocr-worker.js`.
4. Change this line:

```js
workerPromise = window.Tesseract.createWorker("eng", 1, {
```

For example, Hindi would become:

```js
workerPromise = window.Tesseract.createWorker("hin", 1, {
```

To recognize more than one language at the same time, join language codes with a plus sign, like:

```js
workerPromise = window.Tesseract.createWorker("eng+hin", 1, {
```

Make sure every language code you use has a matching `.traineddata.gz` file in the `lang` folder.
