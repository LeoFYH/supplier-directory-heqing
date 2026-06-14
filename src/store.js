import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates");
export const DEFAULT_TEMPLATE_PATH = path.join(
  TEMPLATE_DIR,
  "qualified-suppliers-template.xlsx",
);
export const ACTIVE_TEMPLATE_PATH = path.join(DATA_DIR, "template.xlsx");
export const STORE_PATH = path.join(DATA_DIR, "suppliers.json");
export const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

const emptyStore = {
  suppliers: [],
  history: [],
  lastImport: null,
  updatedAt: null,
};

export async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });

  try {
    await fs.access(STORE_PATH);
  } catch {
    await writeStore(emptyStore);
  }

  try {
    await fs.access(ACTIVE_TEMPLATE_PATH);
  } catch {
    await fs.copyFile(DEFAULT_TEMPLATE_PATH, ACTIVE_TEMPLATE_PATH);
  }
}

export async function readStore() {
  await ensureDataFiles();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...emptyStore,
    ...parsed,
    suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

export async function writeStore(nextStore) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${STORE_PATH}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STORE_PATH);
}

export async function saveActiveTemplate(buffer) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ACTIVE_TEMPLATE_PATH, buffer);
}

export async function saveUploadArchive(buffer, archiveName) {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const archivePath = path.join(ARCHIVE_DIR, archiveName);
  await fs.writeFile(archivePath, buffer);
  return archivePath;
}

export function getArchivePath(archiveName) {
  return path.join(ARCHIVE_DIR, path.basename(archiveName));
}

export async function clearAllData() {
  await fs.rm(ARCHIVE_DIR, { recursive: true, force: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.copyFile(DEFAULT_TEMPLATE_PATH, ACTIVE_TEMPLATE_PATH);
  await writeStore(emptyStore);
  return emptyStore;
}
