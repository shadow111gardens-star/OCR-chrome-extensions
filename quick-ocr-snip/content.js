// Snipping overlay, crop logic, clipboard write, and toast UI.
// This file is injected only when the user clicks the extension or presses
// Ctrl+Shift+X / Cmd+Shift+X.

(function setupQuickOcrSnip() {
  if (window.quickOcrSnipLoaded) return;
  window.quickOcrSnipLoaded = true;

  let state = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "QOS_START_SNIP") {
      startSelection();
    }
  });

  function startSelection() {
    cleanupSelection();

    state = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      dragging: false,
      overlay: document.createElement("div"),
      clearArea: document.createElement("div"),
      label: document.createElement("div")
    };

    state.overlay.className = "qos-overlay";
    state.clearArea.className = "qos-clear-area";
    state.label.className = "qos-size-label";

    state.overlay.append(state.clearArea, state.label);
    document.documentElement.appendChild(state.overlay);
    document.documentElement.classList.add("qos-snipping");

    state.overlay.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function onMouseDown(event) {
    if (!state || event.button !== 0) return;

    event.preventDefault();
    state.dragging = true;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.currentX = event.clientX;
    state.currentY = event.clientY;
    state.overlay.classList.add("qos-has-selection");
    updateSelectionBox();
  }

  function onMouseMove(event) {
    if (!state || !state.dragging) return;

    event.preventDefault();
    state.currentX = event.clientX;
    state.currentY = event.clientY;
    updateSelectionBox();
  }

  async function onMouseUp(event) {
    if (!state || !state.dragging) return;

    event.preventDefault();
    state.dragging = false;

    const rect = getSelectionRect();
    if (rect.width < 5 || rect.height < 5) {
      cleanupSelection();
      return;
    }

    showProcessing("Extracting text...");

    try {
      state.overlay.classList.add("qos-capturing");
      await waitForPaint();

      const capture = await chrome.runtime.sendMessage({ type: "QOS_CAPTURE_VISIBLE_TAB" });
      if (!capture?.ok) throw new Error(capture?.error || "Could not capture the tab.");

      state.overlay.classList.remove("qos-capturing");

      // વિડિયો સિલેક્શન ચેક
      const isVideoSelection = document.querySelector("video");
      if (!isVideoSelection) {
        const domText = extractTextFromPage(rect);
        if (domText) {
          cleanupSelection();
          const copied = await copyText(domText);
          console.log("COPIED TEXT:", domText);
          if (copied) {
            showToast("Text Copied!", "success");
          } else {
            showToast("Clipboard failed", "error");
          }
          return;
        }
      }

      // સ્ટેપ ૪ મુજબ: YouTube/video OCR → only use screenshot capture (Do NOT use cropVisibleVideos)
      const croppedImages = await cropVisibleCapture(capture.dataUrl, rect);
      
      // અહીં તમારો ફેરફાર (console.log) એડ થઈ ગયો છે
      console.log(
        "OCR IMAGE:",
        croppedImages[0]
      );

      const text = (await recognizeWithOcrFrame(croppedImages)).trim();

      cleanupSelection();

      if (!text) {
        showToast(isLikelyBlankCapture(croppedImages) ? "Video frame could not be read" : "No text detected", "error");
        return;
      }

      const copied = await copyText(text);
      console.log("COPIED TEXT:", text);

      if (copied) {
        showToast("Text Copied!", "success");
      } else {
        showToast("Clipboard failed", "error");
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error("Quick OCR Snip failed:", errorMessage, error);
      cleanupSelection();
      showToast(errorMessage || "No text detected", "error");
    }
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;

    event.preventDefault();
    cleanupSelection();
  }

  function updateSelectionBox() {
    const rect = getSelectionRect();

    state.clearArea.style.left = `${rect.left}px`;
    state.clearArea.style.top = `${rect.top}px`;
    state.clearArea.style.width = `${rect.width}px`;
    state.clearArea.style.height = `${rect.height}px`;
    state.clearArea.hidden = rect.width === 0 || rect.height === 0;

    state.label.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
    state.label.style.left = `${Math.min(rect.left + rect.width + 10, window.innerWidth - 110)}px`;
    state.label.style.top = `${Math.max(8, rect.top - 34)}px`;
    state.label.hidden = rect.width === 0 || rect.height === 0;
  }

  function getSelectionRect() {
    const left = Math.max(0, Math.min(state.startX, state.currentX));
    const top = Math.max(0, Math.min(state.startY, state.currentY));
    const right = Math.min(window.innerWidth, Math.max(state.startX, state.currentX));
    const bottom = Math.min(window.innerHeight, Math.max(state.startY, state.currentY));

    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function showProcessing(message) {
    if (!state) return;

    state.label.textContent = message;
    state.label.hidden = false;
    state.label.classList.add("qos-processing");
  }

  function cleanupSelection() {
    if (!state) return;

    state.overlay.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("keydown", onKeyDown, true);

    state.overlay.remove();
    document.documentElement.classList.remove("qos-snipping");
    state = null;
  }

  async function cropVisibleCapture(dataUrl, rect) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;

    // સ્ટેપ ૨ મુજબ: padding ૧૦ માંથી ૦ કરી દીધું છે
    const padding = 0;
    const paddedLeft = Math.max(0, rect.left - padding);
    const paddedTop = Math.max(0, rect.top - padding);
    const paddedRight = Math.min(window.innerWidth, rect.left + rect.width + padding);
    const paddedBottom = Math.min(window.innerHeight, rect.top + rect.height + padding);

    const sourceLeft = Math.round(paddedLeft * scaleX);
    const sourceTop = Math.round(paddedTop * scaleY);
    const sourceWidth = Math.max(1, Math.round((paddedRight - paddedLeft) * scaleX));
    const sourceHeight = Math.max(1, Math.round((paddedBottom - paddedTop) * scaleY));

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    context.drawImage(
      image,
      sourceLeft,
      sourceTop,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    return preprocessForOcr(canvas);
  }

  function getVideoContentRect(video, videoRect) {
    const objectFit = window.getComputedStyle(video).objectFit || "contain";

    if (objectFit === "fill") return videoRect;

    const elementRatio = videoRect.width / videoRect.height;
    const videoRatio = video.videoWidth / video.videoHeight;
    let width = videoRect.width;
    let height = videoRect.height;

    if (objectFit === "cover" ? videoRatio < elementRatio : videoRatio > elementRatio) {
      height = videoRect.width / videoRatio;
    } else {
      width = videoRect.height * videoRatio;
    }

    return {
      left: videoRect.left + (videoRect.width - width) / 2,
      top: videoRect.top + (videoRect.height - height) / 2,
      right: videoRect.left + (videoRect.width + width) / 2,
      bottom: videoRect.top + (videoRect.height + height) / 2,
      width,
      height
    };
  }

  function getIntersection(first, second) {
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.left + first.width, second.right);
    const bottom = Math.min(first.top + first.height, second.bottom);

    if (right <= left || bottom <= top) return null;

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  // સ્ટેપ ૧ મુજબ: નવું સિંગલ વેરિઅન્ટ વાળું preprocessForOcr() ફંક્શન
  function preprocessForOcr(sourceCanvas) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = sourceCanvas.width * 3;
    canvas.height = sourceCanvas.height * 3;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sourceCanvas,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return [
      canvas.toDataURL("image/png")
    ];
  }

 
 /* function addWhiteBorder(sourceCanvas) {
    const padding = 30;
    const outputCanvas = document.createElement("canvas");
    const context = outputCanvas.getContext("2d");

    outputCanvas.width = sourceCanvas.width + padding * 2;
    outputCanvas.height = sourceCanvas.height + padding * 2;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.drawImage(sourceCanvas, padding, padding);

    return outputCanvas;
  }*/

    function upscaleCanvas(sourceCanvas, smooth) {

  const outputCanvas =
    document.createElement("canvas");

  const outputContext =
    outputCanvas.getContext("2d");

  const scale = 5;

  outputCanvas.width =
    sourceCanvas.width * scale;

  outputCanvas.height =
    sourceCanvas.height * scale;

  outputContext.imageSmoothingEnabled =
    smooth;

  outputContext.imageSmoothingQuality =
    "high";

  outputContext.drawImage(
    sourceCanvas,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height
  );

  return outputCanvas;
}

  function makePixelVariant(sourceCanvas, mode) {
    const outputCanvas = document.createElement("canvas");
    const context = outputCanvas.getContext("2d");

    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;
    context.drawImage(sourceCanvas, 0, 0);

    const imageData = context.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const gray = red * 0.299 + green * 0.587 + blue * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.9 + 128));
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max - min;
      const looksWhite = gray > 150 && saturation < 95;
      const looksYellow = red > 135 && green > 115 && blue < 135 && red - blue > 35 && green - blue > 25;
      let value = contrasted;

      if (mode === "threshold") value = contrasted > 150 ? 255 : 0;
      if (mode === "invert-threshold") value = contrasted > 150 ? 0 : 255;
      if (mode === "bright-text") value = looksWhite ? 0 : 255;
      if (mode === "yellow-white-text") value = looksWhite || looksYellow ? 0 : 255;

      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }

    context.putImageData(imageData, 0, 0);

    return outputCanvas;
  }

  function isLikelyBlankCapture(imageDataUrls) {
    if (!imageDataUrls.length) return true;

    const first = imageDataUrls[0];
    return first.length < 1500;
  }

  let ocrFrame = null;
  let ocrFrameReady = null;
  let ocrRequestId = 0;
  const pendingFrameRequests = new Map();

  function recognizeWithOcrFrame(imageDataUrls) {
    return new Promise(async (resolve, reject) => {
      try {
        await ensureOcrFrame();

        const requestId = `qos-${Date.now()}-${ocrRequestId++}`;
        pendingFrameRequests.set(requestId, { resolve, reject });

        ocrFrame.contentWindow.postMessage({
          source: "QOS_CONTENT",
          type: "QOS_RECOGNIZE",
          requestId,
          imageDataUrls
        }, chrome.runtime.getURL("").slice(0, -1));
      } catch (error) {
        reject(error);
      }
    });
  }

  function ensureOcrFrame() {
    if (ocrFrameReady) return ocrFrameReady;

    ocrFrameReady = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("OCR frame did not load."));
      }, 10000);

      window.addEventListener("message", onOcrFrameMessage);

      ocrFrame = document.createElement("iframe");
      ocrFrame.className = "qos-ocr-frame";
      ocrFrame.src = chrome.runtime.getURL("ocr-frame.html");
      ocrFrame.onload = () => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      ocrFrame.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(new Error("OCR frame failed to load."));
      };

      document.documentElement.appendChild(ocrFrame);
    });

    return ocrFrameReady;
  }

  function onOcrFrameMessage(event) {
    if (!ocrFrame || event.source !== ocrFrame.contentWindow) return;
    if (event.data?.source !== "QOS_OCR_FRAME") return;

    const pending = pendingFrameRequests.get(event.data.requestId);
    if (!pending) return;

    pendingFrameRequests.delete(event.data.requestId);

    if (event.data.ok) {
      pending.resolve(event.data.text || "");
      return;
    }

    pending.reject(new Error(event.data.error || "OCR failed."));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load captured image."));
      image.src = dataUrl;
    });
  }

  function extractTextFromPage(rect) {
    const textChunks = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement || state?.overlay.contains(node.parentElement)) return NodeFilter.FILTER_REJECT;

        const style = window.getComputedStyle(node.parentElement);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const range = document.createRange();
      range.selectNodeContents(textNode);

      const intersects = Array.from(range.getClientRects()).some((textRect) => {
        return rectsOverlap(rect, textRect);
      });

      if (intersects) {
        textChunks.push(textNode.nodeValue.trim());
      }

      range.detach();
    }

    return cleanPageText(textChunks.join(" "));
  }

  function rectsOverlap(selectionRect, textRect) {
    return !(
      textRect.right < selectionRect.left ||
      textRect.left > selectionRect.left + selectionRect.width ||
      textRect.bottom < selectionRect.top ||
      textRect.top > selectionRect.top + selectionRect.height
    );
  }

  function cleanPageText(text) {
    return text
      .replace(/\s+/g, " ")
      .trim();
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function showToast(message, type) {
    const existingToast = document.querySelector(".qos-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.className = `qos-toast qos-toast-${type}`;
    toast.textContent = type === "success" ? `SUCCESS: ${message}` : `ERROR: ${message}`;
    document.documentElement.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("qos-toast-hide");
      window.setTimeout(() => toast.remove(), 250);
    }, 2000);
  }

  function getErrorMessage(error) {
    if (!error) return "";
    if (typeof error === "string") return error;
    if (error.message) return error.message;

    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return String(error);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      console.log("Clipboard API success");
      return true;
    } catch (err) {
      console.log("Clipboard API failed. Using fallback.");
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "-9999px";
        textarea.style.opacity = "0";

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const successful = document.execCommand("copy");
        document.body.removeChild(textarea);

        console.log("Fallback copy:", successful);
        return successful;
      } catch (fallbackError) {
        console.error("Fallback clipboard failed:", fallbackError);
        return false;
      }
    }
  }
})();