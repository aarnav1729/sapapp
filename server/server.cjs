require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");
const sql = require("mssql");

const fs = require("fs");
const path = require("path");
const https = require("https");

// Email (Microsoft Graph)
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");

/* ------------------------------ Hardcoded Email ----------------------------- */
const MS_TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const MS_CLIENT_ID = "3d310826-2173-44e5-b9a2-b21e940b67f7";
const MS_CLIENT_SECRET = "2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog";
const SENDER_EMAIL = "spot@premierenergies.com";

const credential = new ClientSecretCredential(
  MS_TENANT_ID,
  MS_CLIENT_ID,
  MS_CLIENT_SECRET
);
const graphClient = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken(
        "https://graph.microsoft.com/.default"
      );
      return tokenResponse.token;
    },
  },
});

async function sendEmail(toEmail, subject, htmlContent, opts = {}) {
  const asList = (v) =>
    Array.isArray(v)
      ? v
      : String(v || "")
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean);
  const normalize = (x) => {
    if (!x) return null;
    const s = String(x).trim();
    return s.includes("@") ? s : `${s}@premierenergies.com`;
  };
  const toNormalized = asList(toEmail).map(normalize).filter(Boolean);
  const ccNormalized = asList(opts.cc).map(normalize).filter(Boolean);
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];

  const message = {
    subject,
    body: { contentType: "HTML", content: htmlContent },
    toRecipients: toNormalized.map((address) => ({
      emailAddress: { address },
    })),
    ...(ccNormalized.length
      ? {
          ccRecipients: ccNormalized.map((address) => ({
            emailAddress: { address },
          })),
        }
      : {}),
    ...(attachments.length ? { attachments } : {}),
  };
  await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({
    message,
    saveToSentItems: true,
  });
}

/* ------------------------------- CCAS emails ------------------------------- */
const APP_NAME = "CCAS";

/** role -> email (dbo.Users) */
async function getUserEmailByRole(role) {
  const pool = await getSapPool();
  const rs = await pool
    .request()
    .input("r", sql.NVarChar(20), role)
    .query("SELECT TOP 1 email FROM dbo.Users WHERE role=@r");
  return rs.recordset[0]?.email || null;
}

function headerBanner(title) {
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0078D4;padding:16px 0;">
  <tr><td align="center">
    <div style="color:#fff;font-family:Arial,sans-serif;">
      <div style="font-size:22px;font-weight:700;margin-bottom:2px;">${title}</div>
      <div style="font-size:12px;opacity:.85;">${APP_NAME} Workflow</div>
    </div>
  </td></tr>
</table>`;
}

function kvTable(pairs) {
  return `
<table cellpadding="10" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;background-color:#fff;margin-top:12px;">
  <tr style="background:#0078D4;color:#fff;">
    <th align="left">Field</th><th align="left">Value</th>
  </tr>
  ${pairs
    .map(
      ([k, v], i) =>
        `<tr style="background:${i % 2 ? "#f7f7f7" : "#ffffff"};">
           <td><strong>${k}</strong></td><td>${v ?? ""}</td>
         </tr>`
    )
    .join("")}
</table>`;
}

/** Load request + latest details + requester email */
async function getRequestBundle(requestId) {
  const pool = await getSapPool();
  const reqRs = await pool
    .request()
    .input("id", sql.NVarChar(36), requestId)
    .query("SELECT * FROM dbo.Requests WHERE requestId=@id");
  const req = reqRs.recordset[0];
  if (!req) return null;

  let details = null;
  if (req.type === "plant") {
    const d = await pool.request().input("id", sql.NVarChar(36), requestId)
      .query(`
        SELECT TOP 1 * FROM dbo.PlantCodeDetails
        WHERE requestId=@id ORDER BY version DESC`);
    details = d.recordset[0] || null;
  } else {
    const d = await pool.request().input("id", sql.NVarChar(36), requestId)
      .query(`
        SELECT TOP 1 * FROM dbo.CompanyCodeDetails
        WHERE requestId=@id ORDER BY version DESC`);
    details = d.recordset[0] || null;
  }

  return { request: req, details };
}

/** Read attachments and convert for Microsoft Graph */
async function getGraphFileAttachments(requestId) {
  const pool = await getSapPool();
  const rs = await pool
    .request()
    .input("id", sql.NVarChar(36), requestId)
    .query(
      `SELECT fileName, fileType, fileContent
         FROM dbo.Attachments
        WHERE requestId=@id
        ORDER BY uploadedAt ASC`
    );
  return rs.recordset.map((r) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: r.fileName,
    contentType: r.fileType,
    contentBytes: Buffer.from(r.fileContent).toString("base64"),
  }));
}

/** Build a details table for the current request (company/plant aware) */
function buildDetailsTable(req, details) {
  const head = [
    ["Request ID", req.requestId],
    ["Title", req.title],
    ["Type", req.type],
    ["Current Status", req.status],
    ["Created By", req.createdBy],
    ["Created At", new Date(req.createdAt).toLocaleString()],
  ];

  const bodyPairs =
    req.type === "plant"
      ? [
          ["Company Code", details?.companyCode],
          ["Plant Code", details?.plantCode],
          ["Name of Plant", details?.nameOfPlant],
          ["Address of Plant", details?.addressOfPlant],
          ["Purchase Org.", details?.purchaseOrganization],
          ["Sales Org.", details?.salesOrganization],
          ["Profit Center", details?.profitCenter],
          ["Cost Centers", details?.costCenters],
          ["Project Code", details?.projectCode],
          ["Storage Location", details?.storageLocationCode],
        ]
      : [
          ["Company Code", details?.companyCode],
          ["Company Name", details?.nameOfCompanyCode],
          ["Shareholding %", details?.shareholdingPercentage],
          ["Segment", details?.segment],
          ["CIN No.", details?.cinNumber],
          ["PAN No.", details?.panNumber],
          ["GST No.", details?.gstNumber],
        ];

  return kvTable([
    ...head,
    ...bodyPairs.filter(([, v]) => v != null && v !== ""),
  ]);
}

/** Confirmation mail to requestor incl. attachments (cc requestor) */
async function sendConfirmationEmail(requestId) {
  const bundle = await getRequestBundle(requestId);
  if (!bundle) return;
  const { request, details } = bundle;
  const attachments = await getGraphFileAttachments(requestId);

  const html = `
<div style="font-family:Arial,sans-serif;color:#333;line-height:1.45;">
  ${headerBanner("🆕 Submission Confirmation")}
  <div style="padding:20px;background:#f9f9f9;max-width:760px;margin:0 auto;">
    <p style="margin:0 0 10px;">Hello <strong>${request.createdBy}</strong>,</p>
    <p style="margin:0 0 14px;">
      Your ${APP_NAME} request has been received. The details are below. Any files you uploaded are attached to this email.
    </p>
    ${buildDetailsTable(request, details)}
    <p style="font-size:12px;color:#666;margin-top:16px;">
      This is an automated message from ${APP_NAME}. For help, contact IT.
    </p>
    <p style="margin-top:18px;">Regards,<br/><strong>Team ${APP_NAME}</strong></p>
  </div>
</div>`;

  await sendEmail(
    request.createdBy,
    `${APP_NAME}: Request ${request.requestId} submitted`,
    html,
    { cc: request.createdBy, attachments }
  );
}

/** Stage mail (pending-* → next approver; sap-updated → IT). Always CC requestor. */
async function sendStageEmail(requestId, newStatus) {
  const bundle = await getRequestBundle(requestId);
  if (!bundle) return;
  const { request, details } = bundle;

  const statusToRole = {
    "pending-secretary": "secretary",
    "pending-siva": "siva",
    "pending-raghu": "raghu",
    "pending-manoj": "manoj",
    "sap-updated": "it",
  };
  const role = statusToRole[newStatus];
  if (!role) return;

  const to = await getUserEmailByRole(role);
  if (!to) return;

  const titles = {
    "pending-secretary": "Approval Needed (Secretarial)",
    "pending-siva": "Approval Needed (Finance Approver 1)",
    "pending-raghu": "Approval Needed (Finance Approver 2)",
    "pending-manoj": "Approval Needed (Finance Approver 3)",
    "sap-updated": "Request Marked as Updated in SAP",
  };
  const subjectBase =
    newStatus === "sap-updated"
      ? `${APP_NAME}: Request ${request.requestId} marked as updated in SAP`
      : `${APP_NAME}: Request ${request.requestId} awaiting your action`;

  const html = `
<div style="font-family:Arial,sans-serif;color:#333;line-height:1.45;">
  ${headerBanner(`📣 ${titles[newStatus] || "Action Needed"}`)}
  <div style="padding:20px;background:#f9f9f9;max-width:760px;margin:0 auto;">
    <p style="margin:0 0 10px;">Hello,</p>
    <p style="margin:0 0 14px;">
      The following request is now <strong>${
        request.status
      }</strong> and requires your attention.
    </p>
    ${buildDetailsTable(request, details)}
    <p style="margin-top:16px;">
      Open ${APP_NAME}: <a href="${`https://code.premierenergies.com:14443`}" style="color:#0078D4;text-decoration:none;">View Request</a>
    </p>
    <p style="font-size:12px;color:#666;margin-top:16px;">
      The requestor has been CC’d on this email.
    </p>
    <p style="margin-top:18px;">Thanks &amp; Regards,<br/><strong>Team ${APP_NAME}</strong></p>
  </div>
</div>`;

  await sendEmail(to, subjectBase, html, { cc: request.createdBy });
}

/* ------------------------------ App & Middleware ---------------------------- */
const app = express();

// Accept large payloads for attachments (base64)
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options(/.*/, cors());

app.use(
  helmet({
    contentSecurityPolicy: false, // SPA with dynamic inline builds
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(morgan("tiny"));

/* ------------------------------ Static hosting ------------------------------ */
const DIST_DIR = path.join(__dirname, "../dist");
app.use(express.static(DIST_DIR));

/* ------------------------------- DB (MSSQL) -------------------------------- */
// Two distinct DBs:
// 1) SPOT (for EMP + OTP login storage)
// 2) sapapp (for your application data)

const COMMON_DB = {
  user: "PEL_DB",
  password: "Pel@0184",
  server: "10.0.50.17",
  port: 1433,
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

const SPOT_DB_NAME = "SPOT"; // EMP + OTP table live here
const SAPAPP_DB_NAME = "sapapp"; // Your app data lives here

const spotDbConfig = { ...COMMON_DB, database: SPOT_DB_NAME };
const sapDbConfig = { ...COMMON_DB, database: SAPAPP_DB_NAME };

let spotPool = null; // for OTP + EMP
let sapPool = null; // for all app endpoints

async function getSpotPool() {
  if (!spotPool) {
    spotPool = await new sql.ConnectionPool(spotDbConfig).connect();
  }
  return spotPool;
}
async function getSapPool() {
  if (!sapPool) {
    sapPool = await new sql.ConnectionPool(sapDbConfig).connect();
  }
  return sapPool;
}

/* --------------------------------- Helpers --------------------------------- */
function ok(res, data) {
  res.json({ ok: true, data });
}
function fail(res, status, message, detail) {
  res.status(status).json({ ok: false, error: message, detail });
}

// Convert base64 string to Buffer (varbinary)
function base64ToBuffer(b64) {
  // strip data URL prefix if present
  const comma = (b64 || "").indexOf(",");
  const clean = comma >= 0 ? b64.slice(comma + 1) : b64;
  return Buffer.from(clean, "base64");
}

const normalizeToEmail = (raw) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  return s.includes("@") ? s : `${s}@premierenergies.com`;
};

// Generate requestId as N/C_DDMMYYYY_### with a per-day, per-prefix counter
async function generateRequestId(ncType = "N") {
  const prefix = String(ncType || "N").toUpperCase() === "C" ? "C" : "N";
  const pool = await getSapPool();

  const rs = await pool.request().input("prefix", sql.NChar(1), prefix).query(`
    DECLARE @d CHAR(8) = CONVERT(CHAR(8), GETDATE(), 112); -- yyyymmdd (server local time)
    MERGE [dbo].[RequestIdCounters] WITH (HOLDLOCK) AS t
    USING (SELECT @d AS yyyymmdd, @prefix AS prefix) AS s
      ON t.prefix = s.prefix AND t.yyyymmdd = s.yyyymmdd
    WHEN MATCHED THEN UPDATE SET t.lastSeq = t.lastSeq + 1
    WHEN NOT MATCHED THEN INSERT(prefix, yyyymmdd, lastSeq) VALUES(s.prefix, s.yyyymmdd, 1)
    OUTPUT inserted.lastSeq AS nextSeq, s.yyyymmdd AS yyyymmdd;
  `);

  const row = rs.recordset[0];
  const yyyymmdd = row.yyyymmdd; // e.g. 20250903
  const ddmmyyyy = `${yyyymmdd.slice(6, 8)}${yyyymmdd.slice(
    4,
    6
  )}${yyyymmdd.slice(0, 4)}`;
  const seq = String(row.nextSeq).padStart(3, "0"); // 001..999

  return `${prefix}_${ddmmyyyy}_${seq}`;
}

/* ------------------------- Schema Bootstrap (sapapp) ------------------------ */
const DDL = `
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'dbo')
  EXEC('CREATE SCHEMA dbo');

-- Users
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[Users](
    [email] NVARCHAR(256) NOT NULL PRIMARY KEY,
    [role] NVARCHAR(20) NOT NULL CHECK ([role] IN ('requestor','it','secretary','siva','raghu','manoj','admin')),
    [createdAt] DATETIME2(3) NOT NULL CONSTRAINT DF_Users_createdAt DEFAULT SYSUTCDATETIME()
  );
END;

-- Sessions (login to be implemented later)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Sessions]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[Sessions](
    [sessionId] UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Sessions_sessionId DEFAULT NEWID() PRIMARY KEY,
    [email] NVARCHAR(256) NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [expiresAt] DATETIME2(3) NOT NULL,
    [createdAt] DATETIME2(3) NOT NULL CONSTRAINT DF_Sessions_createdAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Sessions_Users FOREIGN KEY ([email]) REFERENCES [dbo].[Users]([email]) ON DELETE CASCADE
  );
END;

-- Requests
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Requests]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[Requests](
    [requestId] NVARCHAR(36) NOT NULL PRIMARY KEY,
    [type] NVARCHAR(20) NOT NULL CHECK ([type] IN ('plant','company')),
    [title] NVARCHAR(200) NOT NULL,
    [status] NVARCHAR(30) NOT NULL CHECK ([status] IN ('draft','pending-secretary','pending-siva','pending-raghu','pending-manoj','approved','rejected','sap-updated','completed')),
    [createdBy] NVARCHAR(256) NOT NULL,
    [createdAt] DATETIME2(3) NOT NULL CONSTRAINT DF_Requests_createdAt DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2(3) NOT NULL CONSTRAINT DF_Requests_updatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_Requests_Status ON [dbo].[Requests]([status]);
  CREATE INDEX IX_Requests_Type ON [dbo].[Requests]([type]);
  CREATE INDEX IX_Requests_CreatedBy ON [dbo].[Requests]([createdBy]);
  CREATE INDEX IX_Requests_CreatedAt ON [dbo].[Requests]([createdAt]);
END;

-- PlantCodeDetails (versioned)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PlantCodeDetails]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[PlantCodeDetails](
    [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [requestId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [companyCode] NVARCHAR(50) NOT NULL,
    [gstCertificate] NVARCHAR(200) NULL,
    [plantCode] NVARCHAR(50) NOT NULL,
    [nameOfPlant] NVARCHAR(200) NOT NULL,
    [addressOfPlant] NVARCHAR(500) NULL,
    [purchaseOrganization] NVARCHAR(50) NULL,
    [nameOfPurchaseOrganization] NVARCHAR(200) NULL,
    [salesOrganization] NVARCHAR(50) NULL,
    [nameOfSalesOrganization] NVARCHAR(200) NULL,
    [profitCenter] NVARCHAR(50) NULL,
    [nameOfProfitCenter] NVARCHAR(200) NULL,
    [costCenters] NVARCHAR(200) NULL,
    [nameOfCostCenters] NVARCHAR(200) NULL,
    [projectCode] NVARCHAR(50) NULL,
    [projectCodeDescription] NVARCHAR(200) NULL,
    [storageLocationCode] NVARCHAR(50) NULL,
    [storageLocationDescription] NVARCHAR(200) NULL,
    CONSTRAINT UQ_Plant_Request_Version UNIQUE ([requestId],[version]),
    CONSTRAINT FK_Plant_Request FOREIGN KEY ([requestId]) REFERENCES [dbo].[Requests]([requestId]) ON DELETE CASCADE
  );
  CREATE INDEX IX_Plant_RequestId ON [dbo].[PlantCodeDetails]([requestId]);
END;

-- CompanyCodeDetails (versioned)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CompanyCodeDetails]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[CompanyCodeDetails](
    [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [requestId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [companyCode] NVARCHAR(50) NOT NULL,
    [nameOfCompanyCode] NVARCHAR(200) NOT NULL,
    [shareholdingPercentage] DECIMAL(5,2) NULL,
    [gstCertificate] NVARCHAR(200) NULL,
    [cin] NVARCHAR(50) NULL,
    [pan] NVARCHAR(20) NULL,
    [segment] NVARCHAR(50) NULL,
    [nameOfSegment] NVARCHAR(200) NULL,
    CONSTRAINT UQ_Company_Request_Version UNIQUE ([requestId],[version]),
    CONSTRAINT FK_Company_Request FOREIGN KEY ([requestId]) REFERENCES [dbo].[Requests]([requestId]) ON DELETE CASCADE
  );
  CREATE INDEX IX_Company_RequestId ON [dbo].[CompanyCodeDetails]([requestId]);
END;

-- Attachments
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Attachments]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[Attachments](
    [attachmentId] NVARCHAR(40) NOT NULL PRIMARY KEY,
    [requestId] NVARCHAR(36) NOT NULL,
    [fileName] NVARCHAR(255) NOT NULL,
    [fileType] NVARCHAR(100) NOT NULL,
    [fileContent] VARBINARY(MAX) NOT NULL,
    [version] INT NOT NULL,
    [title] NVARCHAR(255) NULL,
    [uploadedBy] NVARCHAR(256) NOT NULL,
    [uploadedAt] DATETIME2(3) NOT NULL CONSTRAINT DF_Attachments_uploadedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Attach_Request FOREIGN KEY ([requestId]) REFERENCES [dbo].[Requests]([requestId]) ON DELETE CASCADE
  );
  CREATE INDEX IX_Attach_RequestId ON [dbo].[Attachments]([requestId]);
END;

-- Approvals
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Approvals]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[Approvals](
    [requestId] NVARCHAR(36) NOT NULL,
    [approverEmail] NVARCHAR(256) NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [decision] NVARCHAR(10) NOT NULL CHECK ([decision] IN ('approve','reject')),
    [comment] NVARCHAR(2000) NULL,
    [attachmentId] NVARCHAR(40) NULL,
    [timestamp] DATETIME2(3) NOT NULL CONSTRAINT DF_Approvals_ts DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Approvals PRIMARY KEY ([requestId],[approverEmail]),
    CONSTRAINT FK_Approvals_Request FOREIGN KEY ([requestId]) REFERENCES [dbo].[Requests]([requestId]) ON DELETE CASCADE
  );
  CREATE INDEX IX_Approvals_RequestId ON [dbo].[Approvals]([requestId]);
END;

-- HistoryLogs
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[HistoryLogs]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[HistoryLogs](
    [requestId] NVARCHAR(36) NOT NULL,
    [timestamp] DATETIME2(3) NOT NULL,
    [action] NVARCHAR(20) NOT NULL,
    [user] NVARCHAR(256) NOT NULL,
    [metadata] NVARCHAR(MAX) NULL,
    CONSTRAINT PK_History PRIMARY KEY ([requestId],[timestamp]),
    CONSTRAINT FK_History_Request FOREIGN KEY ([requestId]) REFERENCES [dbo].[Requests]([requestId]) ON DELETE CASCADE
  );
  CREATE INDEX IX_History_RequestId ON [dbo].[HistoryLogs]([requestId]);
END;

-- RequestIdCounters (per-day sequence per prefix)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RequestIdCounters]') AND type in (N'U'))
BEGIN
  CREATE TABLE [dbo].[RequestIdCounters](
    [prefix]   NCHAR(1)  NOT NULL,
    [yyyymmdd] CHAR(8)   NOT NULL,
    [lastSeq]  INT       NOT NULL CONSTRAINT DF_RequestIdCounters_lastSeq DEFAULT(0),
    CONSTRAINT PK_RequestIdCounters PRIMARY KEY ([prefix],[yyyymmdd])
  );
END;
`;

async function ensureSapSchemaAndSeed() {
  const pool = await getSapPool();
  await pool.request().batch(DDL);
  // Seeding removed intentionally.
}

/* ------------------------------ SPOT OTP Table ------------------------------ */
const OTP_TABLE = "CCASLogin";

async function ensureSpotOtpTable() {
  const pool = await getSpotPool();
  const sqlText = `
DECLARE @tbl sysname = N'${OTP_TABLE}';

IF NOT EXISTS (
    SELECT 1
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
     WHERE t.name = @tbl
       AND s.name = 'dbo'
)
BEGIN
    -- Create only when table is absent
    CREATE TABLE [dbo].[${OTP_TABLE}](
      [Username]    NVARCHAR(255) NOT NULL PRIMARY KEY,
      [OTP]         NVARCHAR(10)  NULL,
      [OTP_Expiry]  DATETIME2(3)  NULL,
      [LEmpID]      NVARCHAR(50)  NULL
    );

    -- ⬇️ If you ever need initial seed rows, put them here so they run ONLY on first create.
    -- Example (currently disabled):
    -- INSERT INTO [dbo].[${OTP_TABLE}] (Username, LEmpID)
    -- SELECT EmpEmail, EmpID FROM dbo.EMP WHERE ActiveFlag = 1;
END;
`;
  await pool.request().batch(sqlText);
}

/* --------------------------------- Health ---------------------------------- */
app.get("/health", async (req, res) => {
  try {
    const sap = await getSapPool();
    await sap.request().query("SELECT 1 AS ok");
    const spot = await getSpotPool();
    await spot.request().query("SELECT TOP 1 1 AS ok FROM sys.objects");
    ok(res, { status: "up" });
  } catch (err) {
    fail(res, 500, "DB down", err.message);
  }
});

/* ======================= OTP AUTH (SPOT: EMP + OTPs) ======================= */
// Request OTP (EMP-validated, OTP stored in dbo.AuditPortalLogin)
app.post("/api/send-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);

    // Only allow company accounts
    if (!fullEmail.endsWith("@premierenergies.com")) {
      return res
        .status(403)
        .json({ message: "Only @premierenergies.com accounts are allowed." });
    }

    const pool = await getSpotPool();
    const empQ = await pool.request().input("em", sql.NVarChar(255), fullEmail)
      .query(`
        SELECT EmpID, EmpName 
        FROM dbo.EMP
        WHERE EmpEmail = @em AND ActiveFlag = 1
      `);

    if (!empQ.recordset.length) {
      return res.status(404).json({
        message:
          "We do not have this email registered in EMP. If you have a company email ID, please contact HR.",
      });
    }

    const empID = String(empQ.recordset[0].EmpID ?? "");

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Upsert OTP into dbo.CCASLogin (SPOT)
    await pool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp)
      .input("exp", sql.DateTime2, expiry)
      .input("emp", sql.NVarChar(50), empID).query(`
        IF EXISTS (SELECT 1 FROM dbo.${OTP_TABLE} WHERE Username = @u)
          UPDATE dbo.${OTP_TABLE} SET OTP = @o, OTP_Expiry = @exp, LEmpID = @emp WHERE Username = @u;
        ELSE
          INSERT INTO dbo.${OTP_TABLE} (Username, OTP, OTP_Expiry, LEmpID) VALUES (@u, @o, @exp, @emp);
      `);

    // CCAS-branded email (same format as reference; app name switched)
    const subject = "CCAS: One-Time Password";
    const content = `
            <div style="font-family:Arial;color:#333;line-height:1.5;">
              <h2 style="color:#0052cc;margin-bottom:.5em;">Welcome to Code Creation Approval System  Application!</h2>
              <p>Your one-time password (OTP) is:</p>
              <p style="font-size:24px;font-weight:bold;color:#0052cc;">${otp}</p>
              <p>This code expires in <strong>5 minutes</strong>.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:2em 0;">
              <p style="font-size:12px;color:#777;">
                If you didn’t request this, ignore this email.<br>
                Need help? contact <a href="mailto:aarnav.singh@premierenergies.com">support</a>.
              </p>
              <p style="margin-top:2em;">Regards,<br/><strong>Team CCAS</strong></p>
            </div>`;
    try {
      await sendEmail(fullEmail, subject, content);
      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (e) {
      // In production we still report sent, but you can expose devOtp if desired
      return res.status(200).json({ message: "OTP generated and queued" });
    }
  } catch (error) {
    console.error("Error in /api/send-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Verify OTP (reads dbo.AuditPortalLogin in SPOT)
app.post("/api/verify-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);
    const otp = (req.body.otp || "").trim();

    // Only allow company accounts
    if (!fullEmail.endsWith("@premierenergies.com")) {
      return res
        .status(403)
        .json({ message: "Only @premierenergies.com accounts are allowed." });
    }

    const pool = await getSpotPool();
    const rs = await pool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp).query(`
        SELECT OTP, OTP_Expiry, LEmpID
        FROM dbo.${OTP_TABLE}
        WHERE Username = @u AND OTP = @o
      `);

    if (!rs.recordset.length) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    const row = rs.recordset[0];
    if (new Date() > new Date(row.OTP_Expiry)) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    // Optional: fetch display name
    const emp = await pool
      .request()
      .input("id", sql.NVarChar(50), String(row.LEmpID ?? "")).query(`
        SELECT TOP 1 EmpName FROM dbo.EMP WHERE EmpID = @id
      `);
    const empName = emp.recordset.length ? emp.recordset[0].EmpName : fullEmail;

    res.status(200).json({
      message: "OTP verified successfully",
      empID: row.LEmpID,
      empName,
    });
  } catch (error) {
    console.error("Error in /api/verify-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------------- App Endpoints ------------------------------ */
// Users
app.get("/api/users", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .query(
        "SELECT email, role, createdAt FROM dbo.Users ORDER BY createdAt DESC"
      );
    ok(res, result.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list users", err.message);
  }
});

app.get("/api/users/:email", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar(256), req.params.email)
      .query("SELECT email, role, createdAt FROM dbo.Users WHERE email=@email");
    ok(res, result.recordset[0] || null);
  } catch (err) {
    fail(res, 500, "Failed to get user", err.message);
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) return fail(res, 400, "email and role are required");
    const pool = await getSapPool();
    await pool
      .request()
      .input("email", sql.NVarChar(256), email)
      .input("role", sql.NVarChar(20), role).query(`
        IF EXISTS (SELECT 1 FROM dbo.Users WHERE email=@email)
          THROW 50001, 'User already exists', 1;
        INSERT INTO dbo.Users(email, role) VALUES(@email, @role);
      `);
    ok(res, { email, role });
  } catch (err) {
    fail(res, 500, "Failed to create user", err.message);
  }
});

app.delete("/api/users/:email", async (req, res) => {
  try {
    const pool = await getSapPool();
    await pool
      .request()
      .input("email", sql.NVarChar(256), req.params.email)
      .query("DELETE FROM dbo.Users WHERE email=@email");
    ok(res, { deleted: req.params.email });
  } catch (err) {
    fail(res, 500, "Failed to delete user", err.message);
  }
});

// Requests
app.get("/api/requests", async (req, res) => {
  try {
    const { createdBy, status, type } = req.query;
    const pool = await getSapPool();
    let query = "SELECT * FROM dbo.Requests WHERE 1=1";
    const r = pool.request();
    if (createdBy) {
      query += " AND createdBy=@createdBy";
      r.input("createdBy", sql.NVarChar(256), String(createdBy));
    }
    if (status) {
      query += " AND status=@status";
      r.input("status", sql.NVarChar(30), String(status));
    }
    if (type) {
      query += " AND type=@type";
      r.input("type", sql.NVarChar(20), String(type));
    }
    query += " ORDER BY createdAt DESC";
    const result = await r.query(query);
    ok(res, result.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list requests", err.message);
  }
});

app.get("/api/requests/:id", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.id)
      .query("SELECT * FROM dbo.Requests WHERE requestId=@id");
    ok(res, result.recordset[0] || null);
  } catch (err) {
    fail(res, 500, "Failed to get request", err.message);
  }
});

app.post("/api/requests", async (req, res) => {
  try {
    let {
      requestId,
      type,
      title,
      status,
      createdBy,
      createdAt,
      updatedAt,
      ncType,
    } = req.body;

    if (!type || !title || !status || !createdBy) {
      return fail(res, 400, "type, title, status, createdBy are required");
    }
    requestId = requestId || (await generateRequestId(ncType)); // ncType: "N" or "C"

    const pool = await getSapPool();
    // Was this request already there? (to compare status)
    const prevRs = await pool
      .request()
      .input("rid", sql.NVarChar(36), requestId)
      .query("SELECT TOP 1 status FROM dbo.Requests WHERE requestId=@rid");
    const prevStatus = prevRs.recordset[0]?.status || null;

    const r = pool
      .request()
      .input("requestId", sql.NVarChar(36), requestId)
      .input("type", sql.NVarChar(20), type)
      .input("title", sql.NVarChar(200), title)
      .input("status", sql.NVarChar(30), status)
      .input("createdBy", sql.NVarChar(256), createdBy)
      .input(
        "createdAt",
        sql.DateTime2(3),
        createdAt ? new Date(createdAt) : null
      )
      .input(
        "updatedAt",
        sql.DateTime2(3),
        updatedAt ? new Date(updatedAt) : null
      );
    await r.query(`
      IF EXISTS (SELECT 1 FROM dbo.Requests WHERE requestId=@requestId)
      BEGIN
        UPDATE dbo.Requests
        SET type=@type, title=@title, status=@status, createdBy=@createdBy,
            updatedAt=ISNULL(@updatedAt, SYSUTCDATETIME())
        WHERE requestId=@requestId;
      END
      ELSE
      BEGIN
        INSERT INTO dbo.Requests(requestId, type, title, status, createdBy, createdAt, updatedAt)
        VALUES(@requestId, @type, @title, @status, @createdBy, ISNULL(@createdAt, SYSUTCDATETIME()), ISNULL(@updatedAt, SYSUTCDATETIME()));
      END
    `);
    try {
      if (prevStatus !== status) {
        await sendStageEmail(requestId, status);
      }
    } catch (e) {
      console.error("sendStageEmail (create) failed:", e);
    }
    ok(res, { requestId });
  } catch (err) {
    fail(res, 500, "Failed to save request", err.message);
  }
});

app.patch("/api/requests/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return fail(res, 400, "status is required");
    const pool = await getSapPool();
    await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.id)
      .input("status", sql.NVarChar(30), status).query(`
        UPDATE dbo.Requests
        SET status=@status, updatedAt=SYSUTCDATETIME()
        WHERE requestId=@id;
      `);
    // NEW: notify next approver (or IT for sap-updated). Always CC requestor.
    try {
      await sendStageEmail(req.params.id, status);
    } catch (e) {
      console.error("sendStageEmail failed:", e);
    }
    ok(res, { requestId: req.params.id, status });
  } catch (err) {
    fail(res, 500, "Failed to update status", err.message);
  }
});

// Plant details (UPSERT)
app.post("/api/plant-details", async (req, res) => {
  try {
    const d = req.body || {};
    const required = [
      "requestId",
      "version",
      "companyCode",
      "plantCode",
      "nameOfPlant",
    ];
    for (const k of required)
      if (d[k] == null || d[k] === "")
        return fail(res, 400, `${k} is required`);

    const pool = await getSapPool();
    const r = pool.request();

    for (const [k, v] of Object.entries(d)) {
      if (k === "version") r.input(k, sql.Int, Number(v));
      else if (k === "requestId") r.input(k, sql.NVarChar(36), v);
      else if (
        [
          "companyCode",
          "gstNumber",
          "plantCode",
          "nameOfPlant",
          "addressOfPlant",
          "purchaseOrganization",
          "nameOfPurchaseOrganization",
          "salesOrganization",
          "nameOfSalesOrganization",
          "profitCenter",
          "nameOfProfitCenter",
          "costCenters",
          "nameOfCostCenters",
          "projectCode",
          "projectCodeDescription",
          "storageLocationCode",
          "storageLocationDescription",
          "gstCertificate",
        ].includes(k)
      ) {
        r.input(k, sql.NVarChar(sql.MAX), v ?? null);
      }
    }

    await r.query(`
        IF EXISTS (SELECT 1 FROM dbo.PlantCodeDetails WHERE requestId=@requestId AND version=@version)
        BEGIN
          UPDATE dbo.PlantCodeDetails
          SET companyCode=@companyCode,
              gstNumber=@gstNumber,
              gstCertificate=@gstCertificate,
              plantCode=@plantCode,
              nameOfPlant=@nameOfPlant,
              addressOfPlant=@addressOfPlant,
              purchaseOrganization=@purchaseOrganization,
              nameOfPurchaseOrganization=@nameOfPurchaseOrganization,
              salesOrganization=@salesOrganization,
              nameOfSalesOrganization=@nameOfSalesOrganization,
              profitCenter=@profitCenter,
              nameOfProfitCenter=@nameOfProfitCenter,
              costCenters=@costCenters,
              nameOfCostCenters=@nameOfCostCenters,
              projectCode=@projectCode,
              projectCodeDescription=@projectCodeDescription,
              storageLocationCode=@storageLocationCode,
              storageLocationDescription=@storageLocationDescription
          WHERE requestId=@requestId AND version=@version;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.PlantCodeDetails(
            requestId, version, companyCode, gstNumber, gstCertificate, plantCode, nameOfPlant, addressOfPlant,
            purchaseOrganization, nameOfPurchaseOrganization, salesOrganization, nameOfSalesOrganization,
            profitCenter, nameOfProfitCenter, costCenters, nameOfCostCenters, projectCode, projectCodeDescription,
            storageLocationCode, storageLocationDescription
          ) VALUES (
            @requestId, @version, @companyCode, @gstNumber, @gstCertificate, @plantCode, @nameOfPlant, @addressOfPlant,
            @purchaseOrganization, @nameOfPurchaseOrganization, @salesOrganization, @nameOfSalesOrganization,
            @profitCenter, @nameOfProfitCenter, @costCenters, @nameOfCostCenters, @projectCode, @projectCodeDescription,
            @storageLocationCode, @storageLocationDescription
          );
        END
      `);

    // NEW: CCAS confirmation email to requestor with attachments
    try {
      await sendConfirmationEmail(d.requestId);
    } catch (e) {
      console.error("sendConfirmationEmail (plant) failed:", e);
    }

    ok(res, { requestId: d.requestId, version: Number(d.version) });
  } catch (err) {
    console.error("Plant UPSERT failed:", err);
    fail(res, 500, "Failed to save plant details", err.message);
  }
});

app.get("/api/plant-details/:requestId/latest", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId).query(`
        SELECT TOP 1 *
        FROM dbo.PlantCodeDetails
        WHERE requestId=@id
        ORDER BY version DESC;
      `);
    ok(res, result.recordset[0] || null);
  } catch (err) {
    fail(res, 500, "Failed to get latest plant details", err.message);
  }
});

app.get("/api/plant-details/:requestId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId)
      .query(
        `SELECT * FROM dbo.PlantCodeDetails WHERE requestId=@id ORDER BY version DESC;`
      );
    ok(res, result.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list plant details", err.message);
  }
});

// Company details
app.post("/api/company-details", async (req, res) => {
  try {
    const d = req.body || {};
    const required = [
      "requestId",
      "version",
      "companyCode",
      "nameOfCompanyCode",
    ];
    for (const k of required)
      if (d[k] == null || d[k] === "")
        return fail(res, 400, `${k} is required`);

    // Coerce shareholdingPercentage cleanly: empty string -> NULL
    const sharePct =
      d.shareholdingPercentage === "" || d.shareholdingPercentage == null
        ? null
        : Number(d.shareholdingPercentage);

    const pool = await getSapPool();
    const r = pool
      .request()
      .input("requestId", sql.NVarChar(36), d.requestId)
      .input("version", sql.Int, Number(d.version))
      .input("companyCode", sql.NVarChar(sql.MAX), d.companyCode ?? null)
      .input(
        "nameOfCompanyCode",
        sql.NVarChar(sql.MAX),
        d.nameOfCompanyCode ?? null
      )
      .input("shareholdingPercentage", sql.Decimal(5, 2), sharePct)
      // ⬇️ new numbers
      .input("gstNumber", sql.NVarChar(sql.MAX), d.gstNumber ?? null)
      .input("cinNumber", sql.NVarChar(sql.MAX), d.cinNumber ?? null)
      .input("panNumber", sql.NVarChar(sql.MAX), d.panNumber ?? null)
      // existing attachments/fields
      .input("gstCertificate", sql.NVarChar(sql.MAX), d.gstCertificate ?? null)
      .input("cin", sql.NVarChar(sql.MAX), d.cin ?? null)
      .input("pan", sql.NVarChar(sql.MAX), d.pan ?? null)
      .input("segment", sql.NVarChar(sql.MAX), d.segment ?? null)
      .input("nameOfSegment", sql.NVarChar(sql.MAX), d.nameOfSegment ?? null);

    await r.query(`
        IF EXISTS (SELECT 1 FROM dbo.CompanyCodeDetails WHERE requestId=@requestId AND version=@version)
        BEGIN
        UPDATE dbo.CompanyCodeDetails
        SET companyCode=@companyCode,
            nameOfCompanyCode=@nameOfCompanyCode,
            shareholdingPercentage=@shareholdingPercentage,
            gstNumber=@gstNumber,
            cinNumber=@cinNumber,
            panNumber=@panNumber,
            gstCertificate=@gstCertificate,
            cin=@cin,
            pan=@pan,
            segment=@segment,
            nameOfSegment=@nameOfSegment
        WHERE requestId=@requestId AND version=@version;

        END
        ELSE
        BEGIN
        INSERT INTO dbo.CompanyCodeDetails(
          requestId, version, companyCode, nameOfCompanyCode, shareholdingPercentage,
          gstNumber, cinNumber, panNumber,
          gstCertificate, cin, pan, segment, nameOfSegment
        ) VALUES (
          @requestId, @version, @companyCode, @nameOfCompanyCode, @shareholdingPercentage,
          @gstNumber, @cinNumber, @panNumber,
          @gstCertificate, @cin, @pan, @segment, @nameOfSegment
        );

        END
      `);

    // NEW: CCAS confirmation email to requestor with attachments
    try {
      await sendConfirmationEmail(d.requestId);
    } catch (e) {
      console.error("sendConfirmationEmail (company) failed:", e);
    }

    ok(res, { requestId: d.requestId, version: Number(d.version) });
  } catch (err) {
    console.error("Company UPSERT failed:", err);
    fail(res, 500, "Failed to save company details", err.message);
  }
});

app.get("/api/company-details/:requestId/latest", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId).query(`
        SELECT TOP 1 *
        FROM dbo.CompanyCodeDetails
        WHERE requestId=@id
        ORDER BY version DESC;
      `);
    ok(res, result.recordset[0] || null);
  } catch (err) {
    fail(res, 500, "Failed to get latest company details", err.message);
  }
});

app.get("/api/company-details/:requestId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId)
      .query(
        `SELECT * FROM dbo.CompanyCodeDetails WHERE requestId=@id ORDER BY version DESC;`
      );
    ok(res, result.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list company details", err.message);
  }
});

// Attachments
app.post("/api/attachments", async (req, res) => {
  try {
    const {
      requestId,
      fileName,
      fileType,
      fileContent,
      version,
      title,
      uploadedBy,
    } = req.body || {};
    if (
      !requestId ||
      !fileName ||
      !fileType ||
      !fileContent ||
      version == null ||
      !uploadedBy
    ) {
      return fail(
        res,
        400,
        "requestId, fileName, fileType, fileContent, version, uploadedBy are required"
      );
    }
    const attachmentId = uuidv4().replace(/-/g, "");
    const buf = base64ToBuffer(fileContent);
    const pool = await getSapPool();
    await pool
      .request()
      .input("attachmentId", sql.NVarChar(40), attachmentId)
      .input("requestId", sql.NVarChar(36), requestId)
      .input("fileName", sql.NVarChar(255), fileName)
      .input("fileType", sql.NVarChar(100), fileType)
      .input("fileContent", sql.VarBinary(sql.MAX), buf)
      .input("version", sql.Int, version)
      .input("title", sql.NVarChar(255), title || null)
      .input("uploadedBy", sql.NVarChar(256), uploadedBy).query(`
        INSERT INTO dbo.Attachments(attachmentId, requestId, fileName, fileType, fileContent, version, title, uploadedBy)
        VALUES(@attachmentId, @requestId, @fileName, @fileType, @fileContent, @version, @title, @uploadedBy);
      `);
    ok(res, { attachmentId });
  } catch (err) {
    fail(res, 500, "Failed to upload attachment", err.message);
  }
});

app.get("/api/attachments/:requestId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId)
      .query(`SELECT attachmentId, requestId, fileName, fileType, version, title, uploadedBy, uploadedAt
              FROM dbo.Attachments WHERE requestId=@id ORDER BY uploadedAt DESC`);
    ok(res, result.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list attachments", err.message);
  }
});

app.get("/api/attachment/:attachmentId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(40), req.params.attachmentId)
      .query(
        `SELECT TOP 1 fileName, fileType, fileContent FROM dbo.Attachments WHERE attachmentId=@id`
      );
    const row = result.recordset[0];
    if (!row) return fail(res, 404, "Attachment not found");
    res.setHeader("Content-Type", row.fileType);
    res.setHeader("Content-Disposition", `inline; filename="${row.fileName}"`);
    res.send(row.fileContent); // varbinary -> Buffer
  } catch (err) {
    fail(res, 500, "Failed to fetch attachment", err.message);
  }
});

// Approvals
app.get("/api/approvals/:requestId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const rs = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId)
      .query(
        "SELECT * FROM dbo.Approvals WHERE requestId=@id ORDER BY [timestamp] ASC"
      );
    ok(res, rs.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list approvals", err.message);
  }
});

app.post("/api/approvals", async (req, res) => {
  try {
    const {
      requestId,
      approverEmail,
      role,
      decision,
      comment,
      attachmentId,
      timestamp,
    } = req.body || {};
    if (!requestId || !approverEmail || !role || !decision) {
      return fail(
        res,
        400,
        "requestId, approverEmail, role, decision are required"
      );
    }
    const pool = await getSapPool();
    await pool
      .request()
      .input("requestId", sql.NVarChar(36), requestId)
      .input("approverEmail", sql.NVarChar(256), approverEmail)
      .input("role", sql.NVarChar(20), role)
      .input("decision", sql.NVarChar(10), decision)
      .input("comment", sql.NVarChar(2000), comment || null)
      .input("attachmentId", sql.NVarChar(40), attachmentId || null)
      .input(
        "timestamp",
        sql.DateTime2(3),
        timestamp ? new Date(timestamp) : null
      ).query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Approvals WHERE requestId=@requestId AND approverEmail=@approverEmail)
          INSERT INTO dbo.Approvals(requestId, approverEmail, role, decision, comment, attachmentId, [timestamp])
          VALUES(@requestId, @approverEmail, @role, @decision, @comment, @attachmentId, ISNULL(@timestamp, SYSUTCDATETIME()));
        ELSE
          UPDATE dbo.Approvals
          SET role=@role, decision=@decision, comment=@comment, attachmentId=@attachmentId, [timestamp]=ISNULL(@timestamp, SYSUTCDATETIME())
          WHERE requestId=@requestId AND approverEmail=@approverEmail;
      `);
    ok(res, { requestId, approverEmail, role, decision });
  } catch (err) {
    fail(res, 500, "Failed to save approval", err.message);
  }
});

// History logs
app.get("/api/history/:requestId", async (req, res) => {
  try {
    const pool = await getSapPool();
    const rs = await pool
      .request()
      .input("id", sql.NVarChar(36), req.params.requestId)
      .query(
        "SELECT * FROM dbo.HistoryLogs WHERE requestId=@id ORDER BY [timestamp] ASC"
      );
    ok(res, rs.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list history logs", err.message);
  }
});

app.post("/api/history", async (req, res) => {
  try {
    const { requestId, action, user, timestamp, metadata } = req.body || {};
    if (!requestId || !action || !user)
      return fail(res, 400, "requestId, action, user are required");
    const pool = await getSapPool();
    await pool
      .request()
      .input("requestId", sql.NVarChar(36), requestId)
      .input(
        "timestamp",
        sql.DateTime2(3),
        timestamp ? new Date(timestamp) : new Date()
      )
      .input("action", sql.NVarChar(20), action)
      .input("user", sql.NVarChar(256), user)
      .input(
        "metadata",
        sql.NVarChar(sql.MAX),
        metadata ? JSON.stringify(metadata) : null
      ).query(`
        INSERT INTO dbo.HistoryLogs(requestId, [timestamp], [action], [user], metadata)
        VALUES(@requestId, @timestamp, @action, @user, @metadata);
      `);
    ok(res, { requestId, action });
  } catch (err) {
    fail(res, 500, "Failed to save history log", err.message);
  }
});

// Aggregated: requests with latest details + approvals count
app.get("/api/requests-with-details", async (req, res) => {
  try {
    const pool = await getSapPool();

    const [reqRs, plantLatest, companyLatest, approvals] = await Promise.all([
      pool.request().query("SELECT * FROM dbo.Requests"),
      pool.request().query(`
        SELECT p.*
        FROM dbo.PlantCodeDetails p
        JOIN (
          SELECT requestId, MAX(version) AS maxVer
          FROM dbo.PlantCodeDetails
          GROUP BY requestId
        ) t ON p.requestId=t.requestId AND p.version=t.maxVer
      `),
      pool.request().query(`
        SELECT c.*
        FROM dbo.CompanyCodeDetails c
        JOIN (
          SELECT requestId, MAX(version) AS maxVer
          FROM dbo.CompanyCodeDetails
          GROUP BY requestId
        ) t ON c.requestId=t.requestId AND c.version=t.maxVer
      `),
      pool
        .request()
        .query(
          `SELECT requestId, COUNT(*) AS approvalsCount FROM dbo.Approvals GROUP BY requestId`
        ),
    ]);

    const plantMap = new Map(
      plantLatest.recordset.map((r) => [r.requestId, r])
    );
    const companyMap = new Map(
      companyLatest.recordset.map((r) => [r.requestId, r])
    );
    const apprMap = new Map(
      approvals.recordset.map((r) => [r.requestId, r.approvalsCount])
    );

    const merged = reqRs.recordset.map((r) => {
      const details =
        r.type === "plant"
          ? plantMap.get(r.requestId)
          : companyMap.get(r.requestId);
      return {
        ...r,
        details: details || null,
        approvalsCount: apprMap.get(r.requestId) || 0,
      };
    });

    ok(res, merged);
  } catch (err) {
    fail(res, 500, "Failed to load requests with details", err.message);
  }
});

// Master code lookups (read-only)
app.get("/api/master/plant-codes", async (req, res) => {
  try {
    const {
      q,
      companyCode,
      plantCode,
      limit = "1000",
      offset = "0",
    } = req.query;
    const pool = await getSapPool();
    let sqlText = `
      SELECT companyCode, plantCode, gstCertificate, nameOfPlant, addressOfPlant,
             purchaseOrganization, nameOfPurchaseOrganization, salesOrganization, nameOfSalesOrganization,
             profitCenter, nameOfProfitCenter, costCenters, nameOfCostCenters,
             projectCode, projectCodeDescription, storageLocationCode, storageLocationDescription
      FROM dbo.MasterPlantCodes WHERE 1=1
    `;
    const r = pool.request();

    if (companyCode) {
      sqlText += " AND companyCode = @cc";
      r.input("cc", sql.NVarChar(50), String(companyCode));
    }
    if (plantCode) {
      sqlText += " AND plantCode = @pc";
      r.input("pc", sql.NVarChar(50), String(plantCode));
    }
    if (q) {
      sqlText += ` AND (
        companyCode LIKE @q OR plantCode LIKE @q OR nameOfPlant LIKE @q
        OR purchaseOrganization LIKE @q OR salesOrganization LIKE @q
        OR profitCenter LIKE @q OR projectCode LIKE @q OR storageLocationCode LIKE @q
      )`;
      r.input("q", sql.NVarChar(200), `%${String(q)}%`);
    }

    sqlText +=
      " ORDER BY companyCode, plantCode OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY";
    r.input("off", sql.Int, Number(offset) || 0);
    r.input("lim", sql.Int, Math.min(10000, Number(limit) || 1000));

    const rs = await r.query(sqlText);
    ok(res, rs.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list plant master", err.message);
  }
});

app.get("/api/master/company-codes", async (req, res) => {
  try {
    const { q, companyCode, limit = "1000", offset = "0" } = req.query;
    const pool = await getSapPool();
    let sqlText = `
      SELECT companyCode, nameOfCompanyCode, shareholdingPercentage, segment, nameOfSegment, cin, pan, gstCertificate
      FROM dbo.MasterCompanyCodes WHERE 1=1
    `;
    const r = pool.request();

    if (companyCode) {
      sqlText += " AND companyCode = @cc";
      r.input("cc", sql.NVarChar(50), String(companyCode));
    }
    if (q) {
      sqlText += ` AND (
        companyCode LIKE @q OR nameOfCompanyCode LIKE @q OR segment LIKE @q
        OR nameOfSegment LIKE @q OR cin LIKE @q OR pan LIKE @q
      )`;
      r.input("q", sql.NVarChar(200), `%${String(q)}%`);
    }

    sqlText +=
      " ORDER BY companyCode OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY";
    r.input("off", sql.Int, Number(offset) || 0);
    r.input("lim", sql.Int, Math.min(10000, Number(limit) || 1000));

    const rs = await r.query(sqlText);
    ok(res, rs.recordset);
  } catch (err) {
    fail(res, 500, "Failed to list company master", err.message);
  }
});

/* ------------------------------ SPA fallback --------------------------------
   This must be after all /api/* routes to let the SPA handle front-end routing.
------------------------------------------------------------------------------- */
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

/* --------------------------------- HTTPS ----------------------------------- */
const PORT = 14443; // single HTTPS port
const HOST = "0.0.0.0";
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "mydomain.key"), "utf8"),
  cert: fs.readFileSync(
    path.join(__dirname, "certs", "d466aacf3db3f299.crt"),
    "utf8"
  ),
  ca: fs.readFileSync(
    path.join(__dirname, "certs", "gd_bundle-g2-g1.crt"),
    "utf8"
  ),
};

/* --------------------------------- Startup --------------------------------- */
(async function start() {
  try {
    // Connect both pools up-front and ensure required schema exists
    await getSpotPool();
    await ensureSpotOtpTable();
    await getSapPool();
    await ensureSapSchemaAndSeed();

    https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
      console.log(`🔐 HTTPS server listening at https://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
})();
