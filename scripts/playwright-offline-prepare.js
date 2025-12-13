#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const cacheRoot = path.resolve(projectRoot, '.cache', 'ms-playwright');
const offlineRoot = path.resolve(projectRoot, 'playwright-cache');

function readBrowsers() {
  const browsersJsonPath = path.join(projectRoot, 'node_modules', 'playwright-core', 'browsers.json');
  const raw = fs.readFileSync(browsersJsonPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed.browsers.filter((b) => b.installByDefault);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyBrowser(browser) {
  const folderName = `${browser.name}-${browser.revision}`;
  const targetDir = path.join(cacheRoot, folderName);
  if (fs.existsSync(targetDir)) {
    console.log(`✔ Browser already staged: ${folderName}`);
    return true;
  }
  const sourceDir = path.join(offlineRoot, folderName);
  if (!fs.existsSync(sourceDir)) {
    console.warn(`✖ Missing ${folderName} in ${offlineRoot}`);
    return false;
  }
  console.log(`→ Copying ${folderName} from offline cache...`);
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log(`✔ Copied ${folderName} to ${targetDir}`);
  return true;
}

function main() {
  ensureDir(cacheRoot);
  const browsers = readBrowsers();
  let allPresent = true;
  for (const browser of browsers) {
    const ok = copyBrowser(browser);
    allPresent = allPresent && ok;
  }
  if (!allPresent) {
    console.error(`\nOffline cache incomplete. To populate it, run:\n`);
    console.error(`  PLAYWRIGHT_BROWSERS_PATH=./playwright-cache npx playwright install chromium`);
    console.error(`on a machine with internet access, then copy the generated 'chromium-<revision>' folder(s) into ${offlineRoot}.`);
    process.exitCode = 1;
  }
}

main();
