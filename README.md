# 合格供应商名录汇总工具

本项目是一个本地网页工具，用于汇总采购供应商 Excel 名录。

## 功能

- 上传固定格式的《合格供应商名录》Excel。
- 按“供应商名称”去重，重复名称使用最新上传记录覆盖旧记录。
- 供应商代码为空不特殊处理，按上传内容保存。
- 导入日期使用 Excel 里填写的内容。
- 导出全部汇总数据。
- 导出文件保持上传模板的标题、编号、字段、合并单元格和版式结构。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

## 数据位置

运行时数据保存在 `data/suppliers.json`，当前导出模板保存在 `data/template.xlsx`。这两个文件不会提交到 GitHub。

默认空模板位于 `templates/qualified-suppliers-template.xlsx`。

## 自检

```bash
npm test
```
