/**
 * A quick look at a photo before it is uploaded: too dark, or blurry?
 *
 * Done in the browser on a small copy, so it costs nothing on the network.
 * Brightness is the mean of the pixels; sharpness is how much neighbouring
 * pixels differ (a soft photo has gentle changes everywhere). The thresholds
 * are deliberately loose: this warns about the bad cases, it does not judge.
 */

export type PhotoCheck = {dark: boolean; blurry: boolean};

const SIZE = 160;

export async function checkPhoto(file: File): Promise<PhotoCheck> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = SIZE / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return {dark: false, blurry: false};
    context.drawImage(bitmap, 0, 0, width, height);
    const {data} = context.getImageData(0, 0, width, height);
    const grey = new Float32Array(width * height);
    let sum = 0;
    for (let i = 0; i < grey.length; i++) {
      const value = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      grey[i] = value;
      sum += value;
    }
    let edges = 0;
    let counted = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const laplacian = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
        edges += Math.abs(laplacian);
        counted++;
      }
    }
    return {dark: sum / grey.length < 60, blurry: counted > 0 && edges / counted < 4};
  } catch {
    return {dark: false, blurry: false};
  }
}
