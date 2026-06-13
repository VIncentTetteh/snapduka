const MAX_EDGE = 1000;
const MAX_BYTES = 10_000_000;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function resizeWithinBounds(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function imageObjectPath(
  sellerId: string,
  productId: string,
  imageId: string,
): string {
  return `${sellerId}/${productId}/${imageId}.webp`;
}

export function validateProductImage(file: {
  type: string;
  size: number;
}): { valid: true } | { valid: false; message: string } {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return { valid: false, message: "Use a JPEG, PNG, or WebP image." };
  }

  if (file.size > MAX_BYTES) {
    return { valid: false, message: "Images must be 10 MB or smaller." };
  }

  return { valid: true };
}

export async function compressProductImage(
  file: File,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = (
    width,
    height,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
): Promise<Blob> {
  const validation = validateProductImage(file);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const bitmap = await createImageBitmap(file);
  const dimensions = resizeWithinBounds(bitmap.width, bitmap.height);
  const canvas = createCanvas(dimensions.width, dimensions.height);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processing is unavailable.");
  }

  context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not process the image.")),
      "image/webp",
      0.82,
    );
  });
}
