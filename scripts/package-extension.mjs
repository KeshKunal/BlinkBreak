import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf8'));

// The output zip file name includes the version
const outputFileName = `BlinkBreak-v${packageJson.version}.zip`;
const outputPath = path.resolve(rootDir, outputFileName);

async function packageExtension() {
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist directory does not exist. Please run build first.');
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({
      zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', () => {
      console.log(`Successfully packaged extension: ${outputFileName} (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`This is the file you should upload to GitHub Releases.`);
      resolve();
    });

    archive.on('error', (err) => {
      console.error('Error creating zip archive:', err);
      reject(err);
    });

    archive.pipe(output);

    // Append files from the dist directory, placing them at the root of the zip
    archive.directory(distDir, false);

    archive.finalize();
  });
}

packageExtension();
