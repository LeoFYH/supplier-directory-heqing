import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { HEADERS, MIN_EXPORT_ROWS, SUPPLIER_FIELDS } from "./constants.js";

const CELL_RE = /<c\b[^>]*\br="([^"]+)"[^>]*>/g;
const ROW_RE = /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g;
const CELL_XML_RE = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
const BUILT_IN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function normalizeSupplierName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCell(value) {
  if (value == null) return "";
  return String(value).replace(/\r?\n/g, " ").trim();
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttr(xml, attrName) {
  return xml.match(new RegExp(`\\b${attrName}="([^"]*)"`))?.[1] ?? "";
}

function readZipText(zip, entryName) {
  const entry = zip.getEntry(entryName);
  return entry ? entry.getData().toString("utf8") : "";
}

function getFirstWorksheetPath(zip) {
  const workbookXml = readZipText(zip, "xl/workbook.xml");
  const relsXml = readZipText(zip, "xl/_rels/workbook.xml.rels");
  const firstSheetTag = workbookXml.match(/<sheet\b[^>]*>/)?.[0];
  const relationshipId = firstSheetTag ? getAttr(firstSheetTag, "r:id") : "";

  if (!relationshipId || !relsXml) return "xl/worksheets/sheet1.xml";

  const relationshipTag = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((match) => match[0])
    .find((tag) => getAttr(tag, "Id") === relationshipId);
  const target = relationshipTag ? getAttr(relationshipTag, "Target") : "";
  if (!target) return "xl/worksheets/sheet1.xml";

  return (target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`))
    .replace(/\\/g, "/");
}

function getFirstSheetName(zip) {
  const workbookXml = readZipText(zip, "xl/workbook.xml");
  const firstSheetTag = workbookXml.match(/<sheet\b[^>]*>/)?.[0];
  return firstSheetTag ? decodeXml(getAttr(firstSheetTag, "name")) : "Sheet1";
}

function extractTextNodes(xml) {
  return [...String(xml ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function parseSharedStrings(zip) {
  const sharedXml = readZipText(zip, "xl/sharedStrings.xml");
  if (!sharedXml) return [];
  return [...sharedXml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) =>
    extractTextNodes(match[0]),
  );
}

function parseDateStyleIds(zip) {
  const stylesXml = readZipText(zip, "xl/styles.xml");
  if (!stylesXml) return new Set();

  const customFormats = new Map();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const tag = match[0];
    const id = Number(getAttr(tag, "numFmtId"));
    const code = decodeXml(getAttr(tag, "formatCode")).toLowerCase();
    customFormats.set(id, code);
  }

  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateStyleIds = new Set();
  let styleIndex = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const tag = match[0];
    const numFmtId = Number(getAttr(tag, "numFmtId") || 0);
    const customCode = customFormats.get(numFmtId) || "";
    const looksLikeDate =
      BUILT_IN_DATE_FORMAT_IDS.has(numFmtId) ||
      (/[ymdhs]/.test(customCode) && !/[0#]\.?[0#]/.test(customCode));

    if (looksLikeDate) dateStyleIds.add(String(styleIndex));
    styleIndex += 1;
  }

  return dateStyleIds;
}

function columnIndexFromRef(cellRef) {
  const letters = String(cellRef).match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function excelSerialDateToText(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value)) return String(serial ?? "");
  const milliseconds = Math.round((value - 25569) * 86400 * 1000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return String(serial);
  return date.toISOString().slice(0, 10);
}

function formatPlainNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (Number.isInteger(number)) return String(number);
  return String(number);
}

function readCellValue({ attrs, innerXml, sharedStrings, dateStyleIds }) {
  if (!innerXml) return "";

  const type = getAttr(attrs, "t");
  const styleId = getAttr(attrs, "s");

  if (type === "inlineStr") return extractTextNodes(innerXml);

  const value = decodeXml(innerXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "");
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (dateStyleIds.has(styleId)) return excelSerialDateToText(value);
  return formatPlainNumber(value);
}

export function parseWorksheetRows(buffer) {
  const zip = new AdmZip(buffer);
  const sheetPath = getFirstWorksheetPath(zip);
  const sheetXml = readZipText(zip, sheetPath);
  if (!sheetXml) return [];

  const sharedStrings = parseSharedStrings(zip);
  const dateStyleIds = parseDateStyleIds(zip);
  const rows = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(rowMatch[1]) - 1;
    const row = rows[rowIndex] || [];
    const rowXml = rowMatch[2];

    for (const cellMatch of rowXml.matchAll(CELL_XML_RE)) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const innerXml = cellMatch[3] ?? "";
      const ref = getAttr(attrs, "r");
      if (!ref) continue;

      row[columnIndexFromRef(ref)] = readCellValue({
        attrs,
        innerXml,
        sharedStrings,
        dateStyleIds,
      });
    }

    rows[rowIndex] = row;
  }

  return rows;
}

function isHeaderRow(row) {
  return HEADERS.every((label, index) => normalizeCell(row[index]) === label);
}

function rowHasSupplierData(row) {
  return row.slice(1, HEADERS.length).some((cell) => normalizeCell(cell) !== "");
}

function findHeaderRowIndex(rows) {
  return rows.findIndex(isHeaderRow);
}

function findFooterRowIndex(rows, headerRowIndex) {
  return rows.findIndex((row, index) => {
    return index > headerRowIndex && normalizeCell(row[0]).startsWith("制表人");
  });
}

function rowToSupplier(row) {
  const supplier = {};
  SUPPLIER_FIELDS.forEach((field, fieldIndex) => {
    supplier[field.key] = normalizeCell(row[fieldIndex + 1]);
  });
  supplier.id = crypto.randomUUID();
  supplier.nameKey = normalizeSupplierName(supplier.supplierName);
  return supplier;
}

export function parseSupplierWorkbook(buffer) {
  const zip = new AdmZip(buffer);
  const sheetName = getFirstSheetName(zip);
  const rows = parseWorksheetRows(buffer);

  if (rows.length === 0) {
    throw new Error("Excel 文件中没有工作表。");
  }

  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    throw new Error("没有找到固定表头，请上传合格供应商名录模板格式的 Excel。");
  }

  const footerRowIndex = findFooterRowIndex(rows, headerRowIndex);
  const endIndex = footerRowIndex === -1 ? rows.length : footerRowIndex;
  const suppliers = rows
    .slice(headerRowIndex + 1, endIndex)
    .filter(rowHasSupplierData)
    .map(rowToSupplier);

  return {
    sheetName,
    headerRow: headerRowIndex + 1,
    footerRow: footerRowIndex === -1 ? null : footerRowIndex + 1,
    suppliers,
  };
}

export function mergeSuppliers(existingSuppliers, incomingSuppliers) {
  const next = [];
  const keyedIndex = new Map();
  let added = 0;
  let updated = 0;

  for (const supplier of existingSuppliers) {
    const normalized = normalizeSupplierName(supplier.supplierName);
    const current = {
      ...supplier,
      nameKey: normalized,
      id: supplier.id || crypto.randomUUID(),
    };
    next.push(current);
    if (normalized && !keyedIndex.has(normalized)) {
      keyedIndex.set(normalized, next.length - 1);
    }
  }

  for (const supplier of incomingSuppliers) {
    const normalized = normalizeSupplierName(supplier.supplierName);
    const replacement = {
      ...supplier,
      nameKey: normalized,
      id: supplier.id || crypto.randomUUID(),
    };

    if (normalized && keyedIndex.has(normalized)) {
      const index = keyedIndex.get(normalized);
      replacement.id = next[index].id;
      next[index] = replacement;
      updated += 1;
      continue;
    }

    next.push(replacement);
    if (normalized) keyedIndex.set(normalized, next.length - 1);
    added += 1;
  }

  return {
    suppliers: next,
    added,
    updated,
    imported: incomingSuppliers.length,
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let value = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function getCellRef(row, column) {
  return `${columnName(column)}${row}`;
}

function getCellStyleMap(sheetXml) {
  const styles = new Map();
  let match;
  while ((match = CELL_RE.exec(sheetXml)) !== null) {
    const tag = match[0];
    const styleMatch = tag.match(/\bs="([^"]+)"/);
    styles.set(match[1], styleMatch ? styleMatch[1] : null);
  }
  return styles;
}

function getRowAttrsMap(sheetXml) {
  const attrs = new Map();
  let match;
  while ((match = ROW_RE.exec(sheetXml)) !== null) {
    const rowNumber = Number(match[1]);
    const openTag = match[0].match(/^<row\b([^>]*)>/)?.[1] || "";
    const preserved = openTag
      .replace(/\s*r="[^"]*"/, "")
      .replace(/\s*spans="[^"]*"/, "")
      .trim();
    attrs.set(rowNumber, preserved);
  }
  return attrs;
}

function extractElement(sheetXml, name) {
  const match = sheetXml.match(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}>`));
  return match ? match[0] : "";
}

function extractSelfClosingOrFullElement(sheetXml, name) {
  return extractElement(sheetXml, name) || sheetXml.match(new RegExp(`<${name}\\b[^>]*/>`))?.[0] || "";
}

function extractTextFromRows(rows, rowNumber, colIndex) {
  return normalizeCell(rows[rowNumber - 1]?.[colIndex - 1]);
}

function styleFor(styles, ref, fallbackRef, forcedStyleRef = null) {
  const style = forcedStyleRef
    ? styles.get(forcedStyleRef)
    : styles.get(ref) ?? styles.get(fallbackRef);
  return style == null ? "" : ` s="${style}"`;
}

function writeCell({
  row,
  column,
  value,
  styles,
  fallbackRef,
  forcedStyleRef = null,
  number = false,
}) {
  const ref = getCellRef(row, column);
  const style = styleFor(styles, ref, fallbackRef, forcedStyleRef);

  if (value === "" || value == null) {
    return `<c r="${ref}"${style}/>`;
  }

  if (number) {
    return `<c r="${ref}"${style}><v>${Number(value)}</v></c>`;
  }

  return `<c r="${ref}"${style} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function writeRow({
  row,
  values,
  styles,
  rowAttrs,
  fallbackRow,
  numericColumns = new Set(),
  forcedStyleRefs = new Map(),
}) {
  const attrs = rowAttrs.get(row) ?? rowAttrs.get(fallbackRow) ?? 'customHeight="1"';
  const rowAttrsText = attrs ? ` ${attrs}` : "";
  const cells = [];

  for (let column = 1; column <= HEADERS.length; column += 1) {
    const fallbackRef = getCellRef(fallbackRow, column);
    cells.push(
      writeCell({
        row,
        column,
        value: values[column - 1] ?? "",
        styles,
        fallbackRef,
        forcedStyleRef: forcedStyleRefs.get(column) || null,
        number: numericColumns.has(column),
      }),
    );
  }

  return `<row r="${row}" spans="1:14"${rowAttrsText}>${cells.join("")}</row>`;
}

function getSupplierRowValues(supplier, index) {
  return [
    index + 1,
    ...SUPPLIER_FIELDS.map((field) => supplier?.[field.key] ?? ""),
  ];
}

function buildSheetXml({ templateSheetXml, templateRows, suppliers }) {
  const styles = getCellStyleMap(templateSheetXml);
  const rowAttrs = getRowAttrsMap(templateSheetXml);
  const headerRow = findHeaderRowIndex(templateRows) + 1 || 3;
  const footerTemplateRow =
    findFooterRowIndex(templateRows, headerRow - 1) + 1 || headerRow + MIN_EXPORT_ROWS + 1;
  const firstDataRow = headerRow + 1;
  const exportDataRows = Math.max(MIN_EXPORT_ROWS, suppliers.length);
  const footerRow = firstDataRow + exportDataRows;
  const trailingRow = footerRow + 1;
  const rootAttrs =
    templateSheetXml.match(/^<worksheet\b([^>]*)>/)?.[1] ||
    ` xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"`;
  const sheetViews = extractElement(templateSheetXml, "sheetViews");
  const sheetFormatPr = extractSelfClosingOrFullElement(templateSheetXml, "sheetFormatPr");
  const cols = extractElement(templateSheetXml, "cols");
  const pageMargins = extractSelfClosingOrFullElement(templateSheetXml, "pageMargins");
  const pageSetup = extractSelfClosingOrFullElement(templateSheetXml, "pageSetup");
  const title = extractTextFromRows(templateRows, 1, 1) || "合格供应商名录";
  const updateLabel = extractTextFromRows(templateRows, 2, 1) || "更新日期：2026年6月14日";
  const codeLabel = extractTextFromRows(templateRows, 2, 13) || "编号：CG2026-001";
  const makerLabel = extractTextFromRows(templateRows, footerTemplateRow, 1) || "制表人：";
  const reviewerLabel = extractTextFromRows(templateRows, footerTemplateRow, 5) || "审核人：";
  const approverLabel = extractTextFromRows(templateRows, footerTemplateRow, 11) || "审批人：";

  const rows = [
    writeRow({
      row: 1,
      values: [title],
      styles,
      rowAttrs,
      fallbackRow: 1,
    }),
    writeRow({
      row: 2,
      values: [updateLabel, "", "", "", "", "", "", "", "", "", "", "", codeLabel, ""],
      styles,
      rowAttrs,
      fallbackRow: 2,
    }),
    writeRow({
      row: headerRow,
      values: HEADERS,
      styles,
      rowAttrs,
      fallbackRow: headerRow,
    }),
  ];

  for (let index = 0; index < exportDataRows; index += 1) {
    rows.push(
      writeRow({
        row: firstDataRow + index,
        values: getSupplierRowValues(suppliers[index], index),
        styles,
        rowAttrs,
        fallbackRow: firstDataRow,
        numericColumns: new Set([1]),
        forcedStyleRefs: new Map([[13, getCellRef(firstDataRow, 2)]]),
      }),
    );
  }

  rows.push(
    writeRow({
      row: footerRow,
      values: [makerLabel, "", "", "", reviewerLabel, "", "", "", "", "", approverLabel],
      styles,
      rowAttrs,
      fallbackRow: footerTemplateRow,
    }),
  );
  rows.push(
    writeRow({
      row: trailingRow,
      values: [],
      styles,
      rowAttrs,
      fallbackRow: footerTemplateRow + 1,
    }),
  );

  const mergeRefs = [
    "A1:N1",
    "A2:D2",
    "M2:N2",
    `A${footerRow}:D${footerRow}`,
    `E${footerRow}:G${footerRow}`,
    `K${footerRow}:N${footerRow}`,
    `A${trailingRow}:B${trailingRow}`,
  ];
  const merges = `<mergeCells count="${mergeRefs.length}">${mergeRefs
    .map((ref) => `<mergeCell ref="${ref}"/>`)
    .join("")}</mergeCells>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet${rootAttrs}>
  <dimension ref="A1:N${trailingRow}"/>
  ${sheetViews}
  ${sheetFormatPr}
  ${cols}
  <sheetData>
    ${rows.join("\n    ")}
  </sheetData>
  ${merges}
  ${pageMargins}
  ${pageSetup}
</worksheet>`;
}

export async function buildExportWorkbook(templatePath, suppliers) {
  const templateBuffer = await fs.readFile(templatePath);
  const zip = new AdmZip(templateBuffer);
  const sheetPath = getFirstWorksheetPath(zip);
  const sheetEntry = zip.getEntry(sheetPath);
  if (!sheetEntry) {
    throw new Error("模板中没有找到第一个工作表。");
  }

  const templateSheetXml = sheetEntry.getData().toString("utf8");
  const templateRows = parseWorksheetRows(templateBuffer);
  const nextSheetXml = buildSheetXml({
    templateSheetXml,
    templateRows,
    suppliers,
  });

  zip.updateFile(sheetPath, Buffer.from(nextSheetXml, "utf8"));
  return zip.toBuffer();
}
