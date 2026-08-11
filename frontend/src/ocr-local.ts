import Tesseract from "tesseract.js";

/**
 * On-device OCR fallback when Gemini cloud key is not configured.
 * Handwriting accuracy is limited — Review/Edit remains mandatory.
 */
export async function localImageToText(imageUriOrBase64: string): Promise<string> {
  const src = imageUriOrBase64.startsWith("data:") || imageUriOrBase64.startsWith("http") || imageUriOrBase64.startsWith("file") || imageUriOrBase64.startsWith("blob")
    ? imageUriOrBase64
    : `data:image/jpeg;base64,${imageUriOrBase64}`;

  const result = await Tesseract.recognize(src, "eng", {
    logger: () => { /* quiet */ },
  });
  return (result?.data?.text || "").trim();
}
