#!/usr/bin/env node
/* insert.cjs
 * One-shot importer for Plant/Company master data from XLSX files.
 * - Reads plant_code.xlsx and company_code.xlsx from the SAME directory as this script (or override via CLI).
 * - Creates tables if missing.
 * - Upserts rows (INSERT or UPDATE) into dbo.MasterPlantCodes / dbo.MasterCompanyCodes.
 *
 * Usage:
 *   node insert.cjs                      # uses ./plant_code.xlsx and ./company_code.xlsx
 *   node insert.cjs ./plant.xlsx ./company.xlsx
 *
 * Requires:
 *   npm i mssql xlsx dotenv
 *   (optional) .env with DB_* values (see config below)
 */

"use strict";

const path = require("path");
const sql = require("mssql");
const XLSX = require("xlsx");
require("dotenv").config();

/* ------------------------------- DB CONFIG -------------------------------- */
const sapDbConfig = {
  user: process.env.DB_USER || "SPOT_USER",
  password: process.env.DB_PASSWORD || "Marvik#72@",
  server: process.env.DB_SERVER || "10.0.40.10",
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || "sapapp",
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

/* ------------------------------- FILE PATHS -------------------------------- */
const PLANT_FILE = process.argv[2] || path.join(__dirname, "plant_code.xlsx");
const COMPANY_FILE =
  process.argv[3] || path.join(__dirname, "company_code.xlsx");

/* ------------------------------ HELPERS ----------------------------------- */
function readSheet(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheet = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
    defval: null,
    raw: true,
  });
}

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Excel headers -> DB columns */
const PLANT_MAP = {
  "Company Code": "companyCode",
  "Plant Code": "plantCode",
  "GST Certificate": "gstCertificate",
  "Name of the Plant": "nameOfPlant",
  "Address of the Plant (as per GST)": "addressOfPlant",
  "Purchase Organization": "purchaseOrganization",
  "Name of Purchase Organization": "nameOfPurchaseOrganization",
  "Sales Organization": "salesOrganization",
  "Name of Sales Organization": "nameOfSalesOrganization",
  "Profit Center": "profitCenter",
  "Name of Profit Center": "nameOfProfitCenter",
  "Cost Center(s)": "costCenters",
  "Name of Cost Center(s)": "nameOfCostCenters",
  "Project Code": "projectCode",
  "Project Code Description": "projectCodeDescription",
  "Storage Location Code": "storageLocationCode",
  "Storage Location Description": "storageLocationDescription",
};

const COMPANY_MAP = {
  "Company Code": "companyCode",
  "Company Name": "nameOfCompanyCode",
  "Shareholding %": "shareholdingPercentage",
  Segment: "segment",
  "Name of Segment": "nameOfSegment",
  CIN: "cin",
  PAN: "pan",
  "GST Certificate": "gstCertificate",
};

function normalizePlantRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(PLANT_MAP)) {
    out[v] = trimOrNull(r[k]);
  }
  return out;
}

function normalizeCompanyRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(COMPANY_MAP)) {
    if (v === "shareholdingPercentage") out[v] = numOrNull(r[k]);
    else out[v] = trimOrNull(r[k]);
  }
  return out;
}

/* --------------------------------- SQL DDL --------------------------------- */
const DDL = `
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MasterPlantCodes]') AND type = N'U')
BEGIN
  CREATE TABLE dbo.MasterPlantCodes(
    companyCode NVARCHAR(50) NOT NULL,
    plantCode NVARCHAR(50) NOT NULL,
    gstCertificate NVARCHAR(200) NULL,
    nameOfPlant NVARCHAR(200) NOT NULL,
    addressOfPlant NVARCHAR(500) NULL,
    purchaseOrganization NVARCHAR(50) NULL,
    nameOfPurchaseOrganization NVARCHAR(200) NULL,
    salesOrganization NVARCHAR(50) NULL,
    nameOfSalesOrganization NVARCHAR(200) NULL,
    profitCenter NVARCHAR(50) NULL,
    nameOfProfitCenter NVARCHAR(200) NULL,
    costCenters NVARCHAR(200) NULL,
    nameOfCostCenters NVARCHAR(200) NULL,
    projectCode NVARCHAR(50) NULL,
    projectCodeDescription NVARCHAR(200) NULL,
    storageLocationCode NVARCHAR(50) NULL,
    storageLocationDescription NVARCHAR(200) NULL,
    CONSTRAINT PK_MasterPlantCodes PRIMARY KEY (companyCode, plantCode)
  );
  CREATE INDEX IX_MasterPlantCodes_Company ON dbo.MasterPlantCodes(companyCode);
  CREATE INDEX IX_MasterPlantCodes_Plant ON dbo.MasterPlantCodes(plantCode);
END;

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MasterCompanyCodes]') AND type = N'U')
BEGIN
  CREATE TABLE dbo.MasterCompanyCodes(
    companyCode NVARCHAR(50) NOT NULL PRIMARY KEY,
    nameOfCompanyCode NVARCHAR(200) NOT NULL,
    shareholdingPercentage DECIMAL(5,2) NULL,
    segment NVARCHAR(50) NULL,
    nameOfSegment NVARCHAR(200) NULL,
    cin NVARCHAR(50) NULL,
    pan NVARCHAR(20) NULL,
    gstCertificate NVARCHAR(200) NULL
  );
END;
`;

/* ------------------------------- UPSERT SQL -------------------------------- */
const MERGE_PLANT = `
MERGE dbo.MasterPlantCodes AS target
USING (VALUES (
  @companyCode, @plantCode, @gstCertificate, @nameOfPlant, @addressOfPlant,
  @purchaseOrganization, @nameOfPurchaseOrganization, @salesOrganization, @nameOfSalesOrganization,
  @profitCenter, @nameOfProfitCenter, @costCenters, @nameOfCostCenters,
  @projectCode, @projectCodeDescription, @storageLocationCode, @storageLocationDescription
)) AS src(
  companyCode, plantCode, gstCertificate, nameOfPlant, addressOfPlant,
  purchaseOrganization, nameOfPurchaseOrganization, salesOrganization, nameOfSalesOrganization,
  profitCenter, nameOfProfitCenter, costCenters, nameOfCostCenters,
  projectCode, projectCodeDescription, storageLocationCode, storageLocationDescription
)
ON target.companyCode = src.companyCode AND target.plantCode = src.plantCode
WHEN MATCHED THEN UPDATE SET
  gstCertificate = src.gstCertificate,
  nameOfPlant = src.nameOfPlant,
  addressOfPlant = src.addressOfPlant,
  purchaseOrganization = src.purchaseOrganization,
  nameOfPurchaseOrganization = src.nameOfPurchaseOrganization,
  salesOrganization = src.salesOrganization,
  nameOfSalesOrganization = src.nameOfSalesOrganization,
  profitCenter = src.profitCenter,
  nameOfProfitCenter = src.nameOfProfitCenter,
  costCenters = src.costCenters,
  nameOfCostCenters = src.nameOfCostCenters,
  projectCode = src.projectCode,
  projectCodeDescription = src.projectCodeDescription,
  storageLocationCode = src.storageLocationCode,
  storageLocationDescription = src.storageLocationDescription
WHEN NOT MATCHED THEN INSERT (
  companyCode, plantCode, gstCertificate, nameOfPlant, addressOfPlant,
  purchaseOrganization, nameOfPurchaseOrganization, salesOrganization, nameOfSalesOrganization,
  profitCenter, nameOfProfitCenter, costCenters, nameOfCostCenters,
  projectCode, projectCodeDescription, storageLocationCode, storageLocationDescription
) VALUES (
  src.companyCode, src.plantCode, src.gstCertificate, src.nameOfPlant, src.addressOfPlant,
  src.purchaseOrganization, src.nameOfPurchaseOrganization, src.salesOrganization, src.nameOfSalesOrganization,
  src.profitCenter, src.nameOfProfitCenter, src.costCenters, src.nameOfCostCenters,
  src.projectCode, src.projectCodeDescription, src.storageLocationCode, src.storageLocationDescription
);
`;

const MERGE_COMPANY = `
MERGE dbo.MasterCompanyCodes AS target
USING (VALUES (
  @companyCode, @nameOfCompanyCode, @shareholdingPercentage, @segment, @nameOfSegment, @cin, @pan, @gstCertificate
)) AS src(
  companyCode, nameOfCompanyCode, shareholdingPercentage, segment, nameOfSegment, cin, pan, gstCertificate
)
ON target.companyCode = src.companyCode
WHEN MATCHED THEN UPDATE SET
  nameOfCompanyCode = src.nameOfCompanyCode,
  shareholdingPercentage = src.shareholdingPercentage,
  segment = src.segment,
  nameOfSegment = src.nameOfSegment,
  cin = src.cin,
  pan = src.pan,
  gstCertificate = src.gstCertificate
WHEN NOT MATCHED THEN INSERT (
  companyCode, nameOfCompanyCode, shareholdingPercentage, segment, nameOfSegment, cin, pan, gstCertificate
) VALUES (
  src.companyCode, src.nameOfCompanyCode, src.shareholdingPercentage, src.segment, src.nameOfSegment, src.cin, src.pan, src.gstCertificate
);
`;

/* --------------------------------- MAIN ------------------------------------ */
(async function main() {
  console.log("🔧 Connecting to MSSQL…");
  const pool = await new sql.ConnectionPool(sapDbConfig).connect();
  try {
    console.log("🧱 Ensuring master tables exist…");
    await pool.request().batch(DDL);

    console.log(`📄 Reading: ${PLANT_FILE}`);
    const plantRaw = readSheet(PLANT_FILE);
    const plantRows = plantRaw
      .map(normalizePlantRow)
      .filter((r) => r.companyCode && r.plantCode && r.nameOfPlant);

    console.log(`📄 Reading: ${COMPANY_FILE}`);
    const companyRaw = readSheet(COMPANY_FILE);
    const companyRows = companyRaw
      .map(normalizeCompanyRow)
      .filter((r) => r.companyCode && r.nameOfCompanyCode);

    console.log(
      `📥 Upserting ${plantRows.length} plant rows & ${companyRows.length} company rows…`
    );
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const plantPs = new sql.PreparedStatement(tx);
      plantPs.input("companyCode", sql.NVarChar(50));
      plantPs.input("plantCode", sql.NVarChar(50));
      plantPs.input("gstCertificate", sql.NVarChar(200));
      plantPs.input("nameOfPlant", sql.NVarChar(200));
      plantPs.input("addressOfPlant", sql.NVarChar(500));
      plantPs.input("purchaseOrganization", sql.NVarChar(50));
      plantPs.input("nameOfPurchaseOrganization", sql.NVarChar(200));
      plantPs.input("salesOrganization", sql.NVarChar(50));
      plantPs.input("nameOfSalesOrganization", sql.NVarChar(200));
      plantPs.input("profitCenter", sql.NVarChar(50));
      plantPs.input("nameOfProfitCenter", sql.NVarChar(200));
      plantPs.input("costCenters", sql.NVarChar(200));
      plantPs.input("nameOfCostCenters", sql.NVarChar(200));
      plantPs.input("projectCode", sql.NVarChar(50));
      plantPs.input("projectCodeDescription", sql.NVarChar(200));
      plantPs.input("storageLocationCode", sql.NVarChar(50));
      plantPs.input("storageLocationDescription", sql.NVarChar(200));
      await plantPs.prepare(MERGE_PLANT);

      for (const r of plantRows) {
        await plantPs.execute(r);
      }
      await plantPs.unprepare();

      const companyPs = new sql.PreparedStatement(tx);
      companyPs.input("companyCode", sql.NVarChar(50));
      companyPs.input("nameOfCompanyCode", sql.NVarChar(200));
      companyPs.input("shareholdingPercentage", sql.Decimal(5, 2));
      companyPs.input("segment", sql.NVarChar(50));
      companyPs.input("nameOfSegment", sql.NVarChar(200));
      companyPs.input("cin", sql.NVarChar(50));
      companyPs.input("pan", sql.NVarChar(20));
      companyPs.input("gstCertificate", sql.NVarChar(200));
      await companyPs.prepare(MERGE_COMPANY);

      for (const r of companyRows) {
        await companyPs.execute(r);
      }
      await companyPs.unprepare();

      await tx.commit();
      console.log("✅ Import complete.");
    } catch (inner) {
      await tx.rollback();
      console.error("❌ Import failed. Rolled back.", inner);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("❌ Fatal:", e);
    process.exitCode = 1;
  } finally {
    pool && pool.close();
  }
})();
