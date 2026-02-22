/**
 * Utility functions for poster image export: clipboard copy & PNG download.
 */

/** Copy canvas content as PNG to clipboard */
export async function copyCanvasToClipboard(
  canvas: HTMLCanvasElement,
): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to create image blob"));
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob }),
          ]);
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      "image/png",
    );
  });
}

/** Download canvas as a PNG file */
export function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filename: string,
): void {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
