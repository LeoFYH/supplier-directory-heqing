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

const searchableFields = [
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

const statusOptions = ["", "合格", "优秀"];

const fileInput = document.querySelector("#fileInput");
const exportButton = document.querySelector("#exportButton");
const refreshButton = document.querySelector("#refreshButton");
const clearArchiveButton = document.querySelector("#clearArchiveButton");
const clearWarning = document.querySelector("#clearWarning");
const dropZone = document.querySelector("#dropZone");
const supplierBody = document.querySelector("#supplierBody");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");
const searchInput = document.querySelector("#searchInput");
const clearSearchButton = document.querySelector("#clearSearchButton");
const searchCount = document.querySelector("#searchCount");
const toast = document.querySelector("#toast");
const totalCount = document.querySelector("#totalCount");
const lastImport = document.querySelector("#lastImport");
const addedCount = document.querySelector("#addedCount");
const updatedCount = document.querySelector("#updatedCount");

let toastTimer = null;
let clearArmed = false;
let clearTimer = null;
let currentStore = {
  suppliers: [],
  history: [],
  lastImport: null,
  updatedAt: null,
};

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

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resetClearWarning() {
  clearArmed = false;
  clearTimeout(clearTimer);
  clearWarning.hidden = true;
  clearArchiveButton.classList.remove("confirm");
  clearArchiveButton.querySelector("span").textContent = "删除历史清档";
}

function supplierMatchesQuery(supplier, query) {
  if (!query) return true;
  return searchableFields.some((field) => normalizeSearch(supplier[field]).includes(query));
}

function getFilteredSuppliers() {
  const query = normalizeSearch(searchInput.value);
  return (currentStore.suppliers || [])
    .map((supplier, originalIndex) => ({ supplier, originalIndex }))
    .filter(({ supplier }) => supplierMatchesQuery(supplier, query));
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

function renderCreditEditor(supplier) {
  return `
    <input
      class="cell-editor"
      data-id="${escapeHtml(supplier.id)}"
      data-field="creditLevel"
      list="creditLevelOptions"
      value="${escapeHtml(supplier.creditLevel)}"
      aria-label="编辑信用等级"
    />`;
}

function renderStatusEditor(supplier) {
  const value = String(supplier.qualifiedStatus ?? "");
  const options = statusOptions.includes(value) ? statusOptions : [...statusOptions, value];
  return `
    <select
      class="cell-editor"
      data-id="${escapeHtml(supplier.id)}"
      data-field="qualifiedStatus"
      aria-label="编辑合格优秀"
    >
      ${options
        .map((option) => {
          const selected = option === value ? " selected" : "";
          const label = option || "未填写";
          return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join("")}
    </select>`;
}

function renderReadonlyCell(supplier, field) {
  if (field === "creditLevel") return renderCreditEditor(supplier);
  if (field === "qualifiedStatus") return renderStatusEditor(supplier);
  return escapeHtml(supplier[field]);
}

function renderSuppliers(store = currentStore) {
  currentStore = {
    ...currentStore,
    ...store,
    suppliers: Array.isArray(store.suppliers) ? store.suppliers : [],
    history: Array.isArray(store.history) ? store.history : [],
  };

  const suppliers = currentStore.suppliers || [];
  const filteredSuppliers = getFilteredSuppliers();
  const query = normalizeSearch(searchInput.value);

  totalCount.textContent = suppliers.length;
  lastImport.textContent = formatTime(currentStore.lastImport?.importedAt);
  addedCount.textContent = currentStore.lastImport?.added ?? 0;
  updatedCount.textContent = currentStore.lastImport?.updated ?? 0;
  searchCount.textContent = query
    ? `${filteredSuppliers.length} / ${suppliers.length} 条`
    : `${suppliers.length} 条`;
  renderHistory(currentStore.history || []);

  if (suppliers.length === 0) {
    supplierBody.innerHTML = '<tr><td class="empty" colspan="14">暂无供应商数据</td></tr>';
    return;
  }

  if (filteredSuppliers.length === 0) {
    supplierBody.innerHTML = '<tr><td class="empty" colspan="14">没有匹配的供应商</td></tr>';
    return;
  }

  supplierBody.innerHTML = filteredSuppliers
    .map(({ supplier, originalIndex }) => {
      const cells = [
        `<td>${originalIndex + 1}</td>`,
        ...fields.map((field) => `<td>${renderReadonlyCell(supplier, field)}</td>`),
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

  searchInput.value = "";
  await loadSuppliers();
  showToast(`导入 ${payload.imported} 条，新增 ${payload.added} 条，覆盖 ${payload.updated} 条。`);
}

async function saveSupplierField(control) {
  const id = control.dataset.id;
  const field = control.dataset.field;
  const value = control.value.trim();
  const supplierIndex = currentStore.suppliers.findIndex((supplier) => supplier.id === id);
  const supplier = currentStore.suppliers[supplierIndex];

  if (!supplier || supplier[field] === value) return;

  control.disabled = true;
  control.classList.add("saving");

  try {
    const response = await fetch(`/api/suppliers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ field, value }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "保存失败。");
    }

    currentStore.suppliers[supplierIndex] = payload.supplier;
    currentStore.updatedAt = payload.updatedAt;
    renderSuppliers(currentStore);
    showToast("已保存。");
  } catch (error) {
    renderSuppliers(currentStore);
    showToast(error.message, "error");
  }
}

async function clearArchive() {
  const response = await fetch("/api/archive", {
    method: "DELETE",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "清档失败。");
  }

  searchInput.value = "";
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

searchInput.addEventListener("input", () => {
  renderSuppliers(currentStore);
});

clearSearchButton.addEventListener("click", () => {
  searchInput.value = "";
  renderSuppliers(currentStore);
  searchInput.focus();
});

supplierBody.addEventListener("change", async (event) => {
  const control = event.target.closest(".cell-editor");
  if (!control) return;
  await saveSupplierField(control);
});

supplierBody.addEventListener("focusout", async (event) => {
  const control = event.target.closest('input.cell-editor[data-field="creditLevel"]');
  if (!control) return;
  await saveSupplierField(control);
});

supplierBody.addEventListener("keydown", (event) => {
  const control = event.target.closest(".cell-editor");
  if (!control || event.key !== "Enter") return;
  event.preventDefault();
  control.blur();
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
