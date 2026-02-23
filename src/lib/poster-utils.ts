/**
 * Utility functions for poster image export.
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

