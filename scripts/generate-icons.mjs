import sharp from "sharp";
import { mkdir } from "node:fs/promises";

await mkdir("public/icons", { recursive: true });
await Promise.all(
  [16, 32, 48, 128].map((size) =>
    sharp("public/icons/logo.png")
      .resize(size, size)
      .png()
      .toFile(`public/icons/icon-${size}.png`),
  ),
);
