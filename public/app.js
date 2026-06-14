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
const dropZone = document.querySelector("#dropZone");
const supplierBody = document.querySelector("#supplierBody");
const toast = document.querySelector("#toast");
const totalCount = document.querySelector("#totalCount");
const lastImport = document.querySelector("#lastImport");
const addedCount = document.querySelector("#addedCount");
const updatedCount = document.querySelector("#updatedCount");

let toastTimer = null;

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

function renderSuppliers(store) {
  const suppliers = store.suppliers || [];
  totalCount.textContent = suppliers.length;
  lastImport.textContent = formatTime(store.lastImport?.importedAt);
  addedCount.textContent = store.lastImport?.added ?? 0;
  updatedCount.textContent = store.lastImport?.updated ?? 0;

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

refreshButton.addEventListener("click", async () => {
  try {
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
