import QRCode from "qrcode";

// Generates a PNG data URI for a QR code that can be used both in <Image>
// and embedded directly in printed HTML.
export async function qrDataUri(text: string, size = 240): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#FFFFFF" },
  });
}

/** High-contrast QR for thermal printers (pure black modules, quieter zone). */
export async function qrDataUriThermal(text: string, size = 280): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}
