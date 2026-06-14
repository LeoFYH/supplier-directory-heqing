import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { HEADERS } from "../src/constants.js";
import {
  buildExportWorkbook,
  mergeSuppliers,
  parseSupplierWorkbook,
  parseWorksheetRows,
} from "../src/excel.js";
import { DEFAULT_TEMPLATE_PATH } from "../src/store.js";

const templateBuffer = await fs.readFile(DEFAULT_TEMPLATE_PATH);
const parsed = parseSupplierWorkbook(templateBuffer);
assert.equal(parsed.suppliers.length, 0, "empty template should not import suppliers");

const firstImport = [
  {
    supplierCode: "A001",
    supplierName: "测试供应商",
    supplierNature: "生产商",
    supplierCategory: "猪肉",
    mainMaterials: "鲜猪肉",
    creditLevel: "A",
    qualifiedStatus: "合格",
    contractStartDate: "2026-01-01",
    contractEndDate: "2026-12-31",
    importDate: "2026-06-14",
    businessContact: "张三",
    phone: "13800000000",
    remark: "",
  },
  {
    supplierCode: "B001",
    supplierName: "冻货供应商",
    supplierNature: "经销商",
    supplierCategory: "冻货",
    mainMaterials: "冷冻鸡肉",
    creditLevel: "B",
    qualifiedStatus: "优秀",
    contractStartDate: "2026-02-01",
    contractEndDate: "2027-01-31",
    importDate: "2026-06-14",
    businessContact: "李四",
    phone: "13900000000",
    remark: "",
  },
];

const secondImport = [
  {
    supplierCode: "A002",
    supplierName: "测试供应商",
    supplierNature: "生产商",
    supplierCategory: "猪肉",
    mainMaterials: "精品猪肉",
    creditLevel: "A+",
    qualifiedStatus: "优秀",
    contractStartDate: "2026-03-01",
    contractEndDate: "2027-02-28",
    importDate: "2026-06-15",
    businessContact: "王五",
    phone: "13700000000",
    remark: "覆盖测试",
  },
];

const mergedOnce = mergeSuppliers([], firstImport);
assert.equal(mergedOnce.added, 2);
assert.equal(mergedOnce.updated, 0);

const mergedTwice = mergeSuppliers(mergedOnce.suppliers, secondImport);
assert.equal(mergedTwice.suppliers.length, 2);
assert.equal(mergedTwice.added, 0);
assert.equal(mergedTwice.updated, 1);
assert.equal(mergedTwice.suppliers[0].supplierCode, "A002");
assert.equal(mergedTwice.suppliers[0].mainMaterials, "精品猪肉");

const exportBuffer = await buildExportWorkbook(DEFAULT_TEMPLATE_PATH, mergedTwice.suppliers);
const rows = parseWorksheetRows(exportBuffer);

assert.equal(rows[0][0], "合格供应商名录");
assert.deepEqual(rows[2].slice(0, 14), HEADERS);
assert.equal(rows[3][0], "1");
assert.equal(rows[3][1], "A002");
assert.equal(rows[3][2], "测试供应商");
assert.equal(rows[3][5], "精品猪肉");
assert.equal(rows[4][2], "冻货供应商");
assert.equal(rows[13][0], "制表人：");
assert.equal(rows[13][4], "审核人：");
assert.equal(rows[13][10], "审批人：");

console.log("self-test passed");
