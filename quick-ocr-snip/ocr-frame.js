// Runs OCR from the extension origin. This avoids YouTube page CSP blocking
// Tesseract's worker creation inside a content script.

(function setupOcrFrame() {
  let workerPromise = null;

  window.addEventListener("message", async (event) => {
    if (event.data?.source !== "QOS_CONTENT") return;

    if (event.data?.type === "QOS_COPY_TEXT") {
      handleCopyRequest(event);
      return;
    }

    if (event.data?.type !== "QOS_RECOGNIZE") return;

    const { requestId, imageDataUrls } = event.data;

    try {
      const text = await recognize(imageDataUrls);
      event.source.postMessage({
        source: "QOS_OCR_FRAME",
        type: "QOS_RECOGNIZE_RESULT",
        requestId,
        ok: true,
        text
      }, event.origin || "*");
    } catch (error) {
      event.source.postMessage({
        source: "QOS_OCR_FRAME",
        type: "QOS_RECOGNIZE_RESULT",
        requestId,
        ok: false,
        error: getErrorMessage(error)
      }, event.origin || "*");
    }
  });

  async function handleCopyRequest(event) {
    const { requestId, text } = event.data;

    try {
      await copyText(text || "");
      event.source.postMessage({
        source: "QOS_OCR_FRAME",
        type: "QOS_COPY_RESULT",
        requestId,
        ok: true
      }, event.origin || "*");
    } catch (error) {
      event.source.postMessage({
        source: "QOS_OCR_FRAME",
        type: "QOS_COPY_RESULT",
        requestId,
        ok: false,
        error: getErrorMessage(error)
      }, event.origin || "*");
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "0";
      textarea.style.top = "0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const copied = document.execCommand("copy");
      textarea.remove();

      if (!copied) throw error;
    }
  }

  async function recognize(imageDataUrls) {
    if (!window.Tesseract) {
      throw new Error("Tesseract is undefined.");
    }

    const worker = await getWorker();
    const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
    const pageModes = [
      Tesseract.PSM.SINGLE_LINE,
      Tesseract.PSM.RAW_LINE,
      Tesseract.PSM.SINGLE_WORD,
      Tesseract.PSM.SPARSE_TEXT,
      Tesseract.PSM.SINGLE_BLOCK
    ];

    let bestText = "";
    let bestScore = -1;

    for (const pageMode of pageModes) {
      await worker.setParameters({ tessedit_pageseg_mode: pageMode });

      for (const imageDataUrl of images) {
        const result = await worker.recognize(imageDataUrl);
        const text = cleanText(result?.data?.text || "");
        const confidence = Number(result?.data?.confidence || 0);
        const score = scoreText(text, confidence);

        if (score > bestScore) {
          bestScore = score;
          bestText = text;
        }

        if (score >= 80 || text.length >= 6) {
          return text;
        }
      }
    }

    return bestText;
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = createConfiguredWorker();
    }

    return workerPromise;
  }

  async function createConfiguredWorker() {
    const extensionUrl = chrome.runtime.getURL("");
    const worker = await Tesseract.createWorker("eng", 1, {
      workerPath: `${extensionUrl}lib/worker.min.js`,
      corePath: `${extensionUrl}lib/tesseract-core.wasm.js`,
      langPath: `${extensionUrl}lang`,
      workerBlobURL: false
    });

    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1"
    });

    return worker;
  }

  function cleanText(text) {
    return text
      .replace(/[|_~`^]+/g, " ")
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function scoreText(text, confidence) {
    const alphaNumericCount = (text.match(/[a-z0-9]/gi) || []).length;
    const wordLikeCount = (text.match(/[a-z0-9]{2,}/gi) || []).length;
    return alphaNumericCount * 14 + wordLikeCount * 25 + text.length + confidence;
  }

  function getErrorMessage(error) {
    if (!error) return "OCR failed.";
    if (typeof error === "string") return error;
    if (error.message) return error.message;

    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return String(error);
    }
  }
})();
