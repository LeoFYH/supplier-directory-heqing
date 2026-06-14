import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_TEMPLATE_PATH,
  clearAllData,
  ensureDataFiles,
  getArchivePath,
  readStore,
  saveActiveTemplate,
  saveUploadArchive,
  writeStore,
} from "./store.js";
import {
  buildExportWorkbook,
  mergeSuppliers,
  parseSupplierWorkbook,
} from "./excel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const PORT = Number(process.env.PORT || 5173);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  "/icons",
  express.static(path.join(__dirname, "..", "node_modules", "lucide-static", "icons")),
);

app.get("/api/suppliers", async (_req, res, next) => {
  try {
    const store = await readStore();
    res.json(store);
  } catch (error) {
    next(error);
  }
});

app.post("/api/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "请选择 Excel 文件。" });
      return;
    }

    const parsed = parseSupplierWorkbook(req.file.buffer);
    const store = await readStore();
    const merged = mergeSuppliers(store.suppliers, parsed.suppliers);
    const now = new Date().toISOString();
    const importId = crypto.randomUUID();
    const archiveName = `${importId}.xlsx`;
    const importRecord = {
      id: importId,
      fileName: req.file.originalname,
      archiveName,
      importedAt: now,
      imported: merged.imported,
      added: merged.added,
      updated: merged.updated,
      total: merged.suppliers.length,
    };
    const nextStore = {
      suppliers: merged.suppliers,
      history: [importRecord, ...(store.history || [])],
      updatedAt: now,
      lastImport: importRecord,
    };

    await saveUploadArchive(req.file.buffer, archiveName);
    await writeStore(nextStore);
    await saveActiveTemplate(req.file.buffer);

    res.json(nextStore.lastImport);
  } catch (error) {
    next(error);
  }
});

app.get("/api/archive/:id/download", async (req, res, next) => {
  try {
    const store = await readStore();
    const record = (store.history || []).find((item) => item.id === req.params.id);
    if (!record) {
      res.status(404).json({ message: "没有找到这条上传历史。" });
      return;
    }

    const archivePath = getArchivePath(record.archiveName);
    await fs.access(archivePath);
    const fileName = encodeURIComponent(record.fileName || "供应商名录上传存档.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`);
    res.sendFile(archivePath);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/archive", async (_req, res, next) => {
  try {
    const store = await clearAllData();
    res.json(store);
  } catch (error) {
    next(error);
  }
});

app.get("/api/export", async (_req, res, next) => {
  try {
    const store = await readStore();
    const output = await buildExportWorkbook(ACTIVE_TEMPLATE_PATH, store.suppliers);
    const fileName = encodeURIComponent("合格供应商名录.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`);
    res.send(output);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    message: error.message || "服务器处理失败。",
  });
});

await ensureDataFiles();

app.listen(PORT, () => {
  console.log(`供应商名录工具已启动：http://localhost:${PORT}`);
});
