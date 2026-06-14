const fields = [
  "supplierCode",
  "supplierName",
  "supplierNature",
  "supplierCategory",
  "mainMaterials",
  "creditLevel",
  "qualifiedStatus",
  "contractStartDate",
  "contractEndDate",
  "importDate",
  "businessContact",
  "phone",
  "remark",
];

const fileInput = document.querySelector("#fileInput");
const exportButton = document.querySelector("#exportButton");
const refreshButton = document.querySelector("#refreshButton");
const clearArchiveButton = document.querySelector("#clearArchiveButton");
const clearWarning = document.querySelector("#clearWarning");
const dropZone = document.querySelector("#dropZone");
const supplierBody = document.querySelector("#supplierBody");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");
const toast = document.querySelector("#toast");
const totalCount = document.querySelector("#totalCount");
const lastImport = document.querySelector("#lastImport");
const addedCount = document.querySelector("#addedCount");
const updatedCount = document.querySelector("#updatedCount");

let toastTimer = null;
let clearArmed = false;
let clearTimer = null;

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resetClearWarning() {
  clearArmed = false;
  clearTimeout(clearTimer);
  clearWarning.hidden = true;
  clearArchiveButton.classList.remove("confirm");
  clearArchiveButton.querySelector("span").textContent = "删除历史清档";
}

function renderHistory(history) {
  const records = Array.isArray(history) ? history : [];
  historyCount.textContent = `${records.length} 条记录`;

  if (records.length === 0) {
    historyList.innerHTML = '<div class="history-empty">暂无上传历史</div>';
    return;
  }

  historyList.innerHTML = records
    .map((record) => {
      const fileName = escapeHtml(record.fileName || "未命名文件");
      const time = escapeHtml(formatTime(record.importedAt));
      const href = `/api/archive/${encodeURIComponent(record.id)}/download`;
      return `
        <div class="history-item">
          <div class="history-main">
            <strong title="${fileName}">${fileName}</strong>
            <span>${time}</span>
          </div>
          <div class="history-stats">
            <span>导入 ${record.imported ?? 0}</span>
            <span>新增 ${record.added ?? 0}</span>
            <span>覆盖 ${record.updated ?? 0}</span>
            <span>汇总 ${record.total ?? 0}</span>
          </div>
          <a class="history-link" href="${href}">
            <img alt="" src="/icons/download.svg" />
            <span>下载存档</span>
          </a>
        </div>`;
    })
    .join("");
}

function renderSuppliers(store) {
  const suppliers = store.suppliers || [];
  totalCount.textContent = suppliers.length;
  lastImport.textContent = formatTime(store.lastImport?.importedAt);
  addedCount.textContent = store.lastImport?.added ?? 0;
  updatedCount.textContent = store.lastImport?.updated ?? 0;
  renderHistory(store.history || []);

  if (suppliers.length === 0) {
    supplierBody.innerHTML = '<tr><td class="empty" colspan="14">暂无供应商数据</td></tr>';
    return;
  }

  supplierBody.innerHTML = suppliers
    .map((supplier, index) => {
      const cells = [
        `<td>${index + 1}</td>`,
        ...fields.map((field) => `<td>${escapeHtml(supplier[field])}</td>`),
      ];
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
}

async function loadSuppliers() {
  const response = await fetch("/api/suppliers");
  if (!response.ok) throw new Error("数据读取失败。");
  renderSuppliers(await response.json());
}

async function importFile(file) {
  if (!file) return;
  resetClearWarning();
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/import", {
    method: "POST",
    body: form,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "导入失败。");
  }

  await loadSuppliers();
  showToast(`导入 ${payload.imported} 条，新增 ${payload.added} 条，覆盖 ${payload.updated} 条。`);
}

async function clearArchive() {
  const response = await fetch("/api/archive", {
    method: "DELETE",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "清档失败。");
  }

  renderSuppliers(payload);
  resetClearWarning();
  showToast("历史和汇总数据已清空。");
}

fileInput.addEventListener("change", async () => {
  try {
    await importFile(fileInput.files[0]);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    fileInput.value = "";
  }
});

exportButton.addEventListener("click", () => {
  window.location.href = "/api/export";
});

clearArchiveButton.addEventListener("click", async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearWarning.hidden = false;
    clearArchiveButton.classList.add("confirm");
    clearArchiveButton.querySelector("span").textContent = "确认清档";
    showToast("清档会删除所有历史和当前汇总数据，再点一次确认。", "error");
    clearTimer = setTimeout(resetClearWarning, 10000);
    return;
  }

  try {
    await clearArchive();
  } catch (error) {
    showToast(error.message, "error");
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    resetClearWarning();
    await loadSuppliers();
    showToast("数据已刷新。");
  } catch (error) {
    showToast(error.message, "error");
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}

dropZone.addEventListener("drop", async (event) => {
  try {
    await importFile(event.dataTransfer.files[0]);
  } catch (error) {
    showToast(error.message, "error");
  }
});

loadSuppliers().catch((error) => showToast(error.message, "error"));
