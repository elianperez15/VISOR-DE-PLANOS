/* ──────────────────────────────────────────────────────────────────────
   image-utils.ts — Optimización de imágenes adjuntas
   Redimensiona/recomprime una imagen (data URL) para ahorrar espacio.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Reduce una imagen a `maxDimension` px máximo y la recomprime. Mantiene PNG si
 * el origen era PNG; si el resultado quedara más grande, conserva el original.
 * @param onComplete (dataUrlSalida, tipoSalida)
 */
export function downscaleImage(
  dataUrl: any, sourceType: string, maxDimension: number, quality: number,
  onComplete: (outputDataUrl: string, outputType: string) => void,
): void {
  const image = new Image();
  image.onload = () => {
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const largestSide = Math.max(width, height);
    if (largestSide > maxDimension) {
      const scaleRatio = maxDimension / largestSide;
      width = Math.round(width * scaleRatio);
      height = Math.round(height * scaleRatio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
    const isPng = sourceType === 'image/png';
    const outputType = isPng ? 'image/png' : 'image/jpeg';
    let outputDataUrl: string;
    try {
      outputDataUrl = canvas.toDataURL(outputType, quality);
    } catch (err) {
      outputDataUrl = dataUrl;
    }
    const isSmaller = outputDataUrl.length < dataUrl.length;
    onComplete(isSmaller ? outputDataUrl : dataUrl, isSmaller ? outputType : sourceType);
  };
  image.onerror = () => onComplete(dataUrl, sourceType);
  image.src = dataUrl;
}
