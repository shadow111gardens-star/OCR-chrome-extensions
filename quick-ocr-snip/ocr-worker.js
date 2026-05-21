// OCR helper loaded into the content-script isolated world.
// Tesseract.js is bundled locally in /lib and all paths below point to files
// inside this extension, so OCR works offline after installation.

(function setupQuickOcrWorker() {
  if (window.quickOcrRecognize) return;

  let workerPromise = null;

  window.quickOcrRecognize = async function quickOcrRecognize(imageDataUrls) {
    if (!window.Tesseract) {
      throw new Error("Tesseract.js did not load.");
    }

    const extensionUrl = chrome.runtime.getURL("");
    const worker = await getWorker(extensionUrl);
    const images = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
    const pageModes = [
      window.Tesseract.PSM.SINGLE_LINE,
      window.Tesseract.PSM.RAW_LINE,
      window.Tesseract.PSM.SINGLE_WORD,
      window.Tesseract.PSM.SPARSE_TEXT,
      window.Tesseract.PSM.SINGLE_BLOCK
    ];

    let bestText = "";
    let bestScore = -1;

    for (const pageMode of pageModes) {
      await worker.setParameters({ tessedit_pageseg_mode: pageMode });

      for (const imageDataUrl of images) {
        const result = await worker.recognize(imageDataUrl);
        const text = (result?.data?.text || "").trim();
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
  };

  function getWorker(extensionUrl) {
    if (!workerPromise) {
      workerPromise = createConfiguredWorker(extensionUrl);
    }

    return workerPromise;
  }

  async function createConfiguredWorker(extensionUrl) {
    const worker = await Tesseract.createWorker("eng", 1, {
      workerPath: `${extensionUrl}lib/worker.min.js`,
      corePath: `${extensionUrl}lib/tesseract-core.wasm.js`,
      langPath: `${extensionUrl}lang`,
      workerBlobURL: false
    });

    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      tessedit_ocr_engine_mode: 1,
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
})();
