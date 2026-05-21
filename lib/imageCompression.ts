"use client";

import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/validation";

const MAX_IMAGE_DIMENSION = 1600;
const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const SKIP_COMPRESSION_BYTES = 900 * 1024;
const TARGET_BYTES = Math.floor(MAX_UPLOAD_BYTES * 0.82);
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5];

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

export async function prepareChatImage(file: File): Promise<File> {
  const sourceMime = normalizeMime(file.type) || mimeFromName(file.name);
  const isAcceptedMime = IMAGE_MIME_TYPES.includes(
    sourceMime as (typeof IMAGE_MIME_TYPES)[number],
  );
  if (!sourceMime.startsWith("image/")) {
    throw new Error("invalid_image_type");
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("image_too_large");

  if (isAcceptedMime && file.size <= SKIP_COMPRESSION_BYTES) return file;

  const loaded = await loadImage(file);
  try {
    const { width, height } = fitInside(
      loaded.width,
      loaded.height,
      MAX_IMAGE_DIMENSION,
    );
    if (
      isAcceptedMime &&
      file.size <= MAX_UPLOAD_BYTES &&
      width === loaded.width &&
      height === loaded.height
    ) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("image_compress_failed");
    ctx.drawImage(loaded.source, 0, 0, width, height);

    const preferredMime = await canvasSupportsWebp(canvas)
      ? "image/webp"
      : sourceMime === "image/png"
        ? "image/png"
        : "image/jpeg";

    let bestBlob: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, preferredMime, quality);
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= TARGET_BYTES) break;
    }

    if (
      !bestBlob ||
      bestBlob.size >= file.size ||
      bestBlob.size > MAX_UPLOAD_BYTES
    ) {
      if (isAcceptedMime && file.size <= MAX_UPLOAD_BYTES) return file;
      if (!bestBlob || bestBlob.size > MAX_UPLOAD_BYTES) {
        throw new Error("image_too_large");
      }
    }

    return new File([bestBlob], compressedName(file.name, bestBlob.type), {
      type: bestBlob.type,
      lastModified: Date.now(),
    });
  } finally {
    loaded.close?.();
  }
}

function fitInside(width: number, height: number, maxDimension: number) {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function loadImage(file: File): Promise<LoadedImage> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall back to the browser image decoder for formats that draw in <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("invalid_image_type"));
      img.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasSupportsWebp(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await canvasToBlob(canvas, "image/webp", 0.7);
    return blob.type === "image/webp";
  } catch {
    return false;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("image_compress_failed"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function compressedName(name: string, mimeType: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const ext = MIME_EXT[normalizeMime(mimeType)] ?? "jpg";
  return `${base}.${ext}`;
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "";
  }
}
