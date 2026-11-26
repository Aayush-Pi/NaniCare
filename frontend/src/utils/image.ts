/** Client-side image preparation for prescription / pill-strip uploads. */

export const MAX_IMAGE_DIMENSION = 1800;
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const COMPRESS_TIMEOUT_MS = 4000;

export function isImageFile(file: { type: string; name?: string }): boolean {
  if (file.type) return file.type.startsWith("image/");
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name ?? "");
}

async function downscaleBitmap(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close?.();
  }
}

/**
 * Downscales large photos (typical phone camera shots are 4-12 MB) to keep uploads
 * fast and under the backend limit. Bounded by a 4-second timeout and falls back
 * to the original file when small, undecodable (e.g. HEIC), or slow on mobile WebViews.
 */
export async function prepareImageFile(file: File): Promise<File> {
  if (!isImageFile(file)) {
    throw new Error("Please choose an image (JPEG, PNG, WebP, or HEIC photo) file.");
  }
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return file;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutFallback = new Promise<File>((resolve) => {
      timer = setTimeout(() => resolve(file), COMPRESS_TIMEOUT_MS);
    });
    return await Promise.race([downscaleBitmap(file), timeoutFallback]);
  } catch {
    return file;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
