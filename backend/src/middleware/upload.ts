import multer from "multer";

export function createMemoryUpload(maxFileSizeMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 }
  });
}
