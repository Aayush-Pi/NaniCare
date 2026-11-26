/** Client-side image preparation for prescription / pill-strip uploads. */

export const MAX_IMAGE_DIMENSION = 1800;
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;

export function isImageFile(file: { type: string; name?: string }): boolean {
  if (file.type) return file.type.startsWith("image/");
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name ?? "");
}

/**
 * Downscales large photos (typical phone camera shots are 4-12 MB) to keep uploads
 * fast and under the backend limit. Returns the original file when it is small,
 * not decodable (e.g. HEIC) or anything fails.
 */
export async function prepareImageFile(file: File): Promise<File> {
  if (!isImageFile(file)) throw new Error("Please choose an image (photo) file.");
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
