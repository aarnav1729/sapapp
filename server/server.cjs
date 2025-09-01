/**
 * server/server.cjs
 * Production-ready Express + MSSQL backend for PEL Workflow (sapapp).
 * - Creates tables on startup (idempotent).
 * - Exposes REST endpoints for users, requests, details, approvals, attachments, history, analytics.
 * - OTP login via separate SPOT DB (EMP + OTP table); email via Microsoft Graph.
 * - Serves frontend + API on a single HTTPS port.
 */
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

async function sendEmail(toEmail, subject, htmlContent) {
  const toList = Array.isArray(toEmail)
    ? toEmail
    : String(toEmail || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

  const normalize = (x) => {
    if (!x) return null;
    const s = String(x).trim();
    return s.includes("@") ? s : `${s}@premierenergies.com`;
  };
  const normalized = toList.map(normalize).filter(Boolean);

  const message = {
    subject,
    body: { contentType: "HTML", content: htmlContent },
    toRecipients: normalized.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };
  await graphClient
    .api(`/users/${SENDER_EMAIL}/sendMail`)
    .post({ message, saveToSentItems: true });
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
  user: "SPOT_USER",
  password: "Marvik#72@",
  server: "10.0.40.10",
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
`;

async function ensureSapSchemaAndSeed() {
  const pool = await getSapPool();
  await pool.request().batch(DDL);

  // Seed default users (idempotent)
  const defaults = [
    { email: "it@pel.com", role: "it" },
    { email: "sec@pel.com", role: "secretary" },
    { email: "manoj@pel.com", role: "manoj" },
    { email: "raghu@pel.com", role: "raghu" },
    { email: "siva@pel.com", role: "siva" },
    { email: "admin@pel.com", role: "admin" },
  ];
  for (const u of defaults) {
    await pool
      .request()
      .input("email", sql.NVarChar(256), u.email)
      .input("role", sql.NVarChar(20), u.role).query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE email=@email)
          INSERT INTO dbo.Users(email, role) VALUES(@email, @role);
      `);
  }
}

/* ------------------------------ SPOT OTP Table ------------------------------ */
const OTP_TABLE = "AuditPortalLogin"; // as in your other project

async function ensureSpotOtpTable() {
  const pool = await getSpotPool();
  const loginTableCheck = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = '${OTP_TABLE}'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.${OTP_TABLE} (
          Username    NVARCHAR(255) NOT NULL PRIMARY KEY,
          OTP         NVARCHAR(10)  NULL,
          OTP_Expiry  DATETIME2     NULL,
          LEmpID      NVARCHAR(50)  NULL
        );
    END;
  `;
  await pool.request().query(loginTableCheck);
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

    // Upsert OTP into dbo.AuditPortalLogin (SPOT)
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

    const subject = "PEL Workflow – Your OTP";
    const content = `
      <p>Welcome to the PEL Workflow Portal.</p>
      <p>Your One-Time Password (OTP) is: <strong>${otp}</strong></p>
      <p>This OTP will expire in 5 minutes.</p>
      <p>Thanks &amp; Regards,<br/>PEL Workflow</p>
    `;
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
    let { requestId, type, title, status, createdBy, createdAt, updatedAt } =
      req.body;
    if (!type || !title || !status || !createdBy) {
      return fail(res, 400, "type, title, status, createdBy are required");
    }
    requestId = requestId || uuidv4();
    const pool = await getSapPool();
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
            requestId, version, companyCode, gstCertificate, plantCode, nameOfPlant, addressOfPlant,
            purchaseOrganization, nameOfPurchaseOrganization, salesOrganization, nameOfSalesOrganization,
            profitCenter, nameOfProfitCenter, costCenters, nameOfCostCenters, projectCode, projectCodeDescription,
            storageLocationCode, storageLocationDescription
          ) VALUES (
            @requestId, @version, @companyCode, @gstCertificate, @plantCode, @nameOfPlant, @addressOfPlant,
            @purchaseOrganization, @nameOfPurchaseOrganization, @salesOrganization, @nameOfSalesOrganization,
            @profitCenter, @nameOfProfitCenter, @costCenters, @nameOfCostCenters, @projectCode, @projectCodeDescription,
            @storageLocationCode, @storageLocationDescription
          );
        END
      `);

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
            requestId, version, companyCode, nameOfCompanyCode, shareholdingPercentage, gstCertificate, cin, pan, segment, nameOfSegment
          ) VALUES (
            @requestId, @version, @companyCode, @nameOfCompanyCode, @shareholdingPercentage, @gstCertificate, @cin, @pan, @segment, @nameOfSegment
          );
        END
      `);

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
