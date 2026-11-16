/**
 * Photos are made smaller on the phone before they are sent: a 12-megapixel
 * picture is 4–6 MB, which on a prepaid connection is a long wait and real
 * money. 1600px on the long edge is more than any page shows, and JPEG at
 * 0.8 looks the same and weighs a tenth.
 */

export const LONG_EDGE = 1600;
export const QUALITY = 0.8;

/** The size to draw at: never larger than it was, the long edge at most `max`. */
export function fitWithin(width: number, height: number, max = LONG_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return {width, height};
  const scale = max / longest;
  return {width: Math.round(width * scale), height: Math.round(height * scale)};
}

/** The photo as a smaller JPEG, or the original where the browser cannot
 *  make one (an old phone, a format it cannot draw): it is still sent. */
export async function compressPhoto(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    // "from-image" turns a phone photo the right way up, as its camera meant.
    const bitmap = await createImageBitmap(file, {imageOrientation: "from-image"});
    const {width, height} = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, {type: "image/jpeg"});
  } catch {
    return file;
  }
}
