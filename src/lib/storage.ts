/* app/src/lib/storage.ts
 * Server-backed storage layer for PEL Workflow (sapapp).
 * Mirrors the previous IndexedDB API so the UI can switch with minimal changes.
 * - Uses fetch() to call the Node/MSSQL backend you dropped into /server/server.cjs
 * - Auth/login is deferred (as requested). Session helpers use localStorage for now.
 */

export interface User {
  email: string;
  role: "requestor" | "it" | "secretary" | "siva" | "raghu" | "manoj" | "admin";
  createdAt: string;
}

export interface Request {
  requestId: string;
  type: "plant" | "company";
  title: string;
  status:
    | "draft"
    | "pending-secretary"
    | "pending-siva"
    | "pending-raghu"
    | "pending-manoj"
    | "approved"
    | "rejected"
    | "sap-updated"
    | "completed";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Not stored on server in Requests—left for UI compatibility if you used it locally */
  version: number;
  isCompleted?: boolean;
  completedAt?: string;
  turnaroundTime?: number; // in days
}

export interface PlantCodeDetails {
  requestId: string;
  companyCode: string;
  gstCertificate: string;
  plantCode: string;
  nameOfPlant: string;
  addressOfPlant: string;
  purchaseOrganization: string;
  nameOfPurchaseOrganization: string;
  salesOrganization: string;
  nameOfSalesOrganization: string;
  profitCenter: string;
  nameOfProfitCenter: string;
  costCenters: string;
  nameOfCostCenters: string;
  projectCode: string;
  projectCodeDescription: string;
  storageLocationCode: string;
  storageLocationDescription: string;
  version: number;
}

export interface CompanyCodeDetails {
  requestId: string;
  companyCode: string;
  nameOfCompanyCode: string;
  shareholdingPercentage: number;
  gstCertificate: string;
  cin: string;
  pan: string;
  segment: string;
  nameOfSegment: string;
  version: number;
}

export interface Attachment {
  attachmentId: string;
  requestId: string;
  fileName: string;
  /** Base64 (data URL ok). When uploading, send base64. When viewing, use getAttachmentDataUrl(). */
  fileContent: string;
  fileType: string;
  version: number;
  title: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Approval {
  requestId: string;
  approverEmail: string;
  role: string;
  decision: "approve" | "reject";
  comment: string;
  attachmentId?: string;
  timestamp: string;
}

export interface HistoryLog {
  requestId: string;
  action: "create" | "edit" | "approve" | "reject" | "update-sap";
  user: string;
  timestamp: string;
  metadata: any;
}

export interface Session {
  email: string;
  role: string;
  expiresAt: string;
}

/* ================================
   API configuration & utilities
   ================================ */

const API_BASE: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as any)?.env?.VITE_API_BASE_URL) ||
  // If you're serving FE and BE on different ports locally:
  (window?.location?.hostname === "localhost"
    ? "https://localhost:14443"
    : window.location.origin.replace(/\/+$/, ""));

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; detail?: any };

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "omit",
    ...init,
  });

  // Binary streams (attachments)
  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (!resp.ok) {
    const body = isJson ? await resp.json().catch(() => ({})) : {};
    const msg =
      (body && (body.error || body.message)) ||
      `HTTP ${resp.status} ${resp.statusText}`;
    throw new Error(`${msg}`);
  }

  if (!isJson) {
    // @ts-expect-error caller will handle blob/arrayBuffer; used in getAttachmentDataUrl
    return resp as any;
  }

  const body = (await resp.json()) as ApiEnvelope<T>;
  if (!("ok" in body) || body.ok !== true) {
    throw new Error(
      (body as any)?.error || "Unknown API error (unexpected envelope)"
    );
  }
  return body.data;
}

function sortByDateDesc<T extends Record<string, any>>(arr: T[], key: string) {
  return [...arr].sort(
    (a, b) => new Date(b[key]).getTime() - new Date(a[key]).getTime()
  );
}

function toISO(d?: string | number | Date | null) {
  return d ? new Date(d).toISOString() : new Date().toISOString();
}

/* ================================
   initDB shim (kept for compatibility)
   ================================ */

let _initted = false;

/**
 * Previous implementation returned an IDB instance; now we just ping the API.
 * Kept to avoid touching the rest of the app code.
 */
export async function initDB(): Promise<null> {
  if (_initted) return null;
  try {
    await http<{ status: string }>("/health");
  } catch (e) {
    // Don’t throw here; allow UI to render while server boots
    // eslint-disable-next-line no-console
    console.error("Health check failed:", e);
  }
  _initted = true;
  return null;
}

/* ================================
   Session (temporary localStorage until login is implemented)
   ================================ */

const SESSION_KEY = "pel_session";

export async function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession(): Promise<Session | null> {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ================================
   Users
   ================================ */

export async function getUserRole(email: string): Promise<string> {
  await initDB();
  try {
    const user = await http<User | null>(
      `/api/users/${encodeURIComponent(email)}`
    );
    return user?.role || "requestor";
  } catch (e) {
    // fallback to requestor if not found/failed
    return "requestor";
  }
}

export const getAllUsers = async (): Promise<User[]> => {
  await initDB();
  const users = await http<User[]>("/api/users");
  return users;
};

export const createUser = async (
  email: string,
  role: string
): Promise<void> => {
  await initDB();
  const payload = { email, role };
  await http<User>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const getUserByEmail = async (email: string): Promise<User | null> => {
  await initDB();
  const user = await http<User | null>(
    `/api/users/${encodeURIComponent(email)}`
  );
  return user || null;
};

export const deleteUser = async (email: string): Promise<void> => {
  await initDB();
  await http(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
};

/* ================================
   Requests
   ================================ */

export async function saveRequest(request: Request) {
  await initDB();
  // server generates/updates updatedAt; keep compatibility
  await http<{ requestId: string }>("/api/requests", {
    method: "POST",
    body: JSON.stringify({
      requestId: request.requestId,
      type: request.type,
      title: request.title,
      status: request.status,
      createdBy: request.createdBy,
      createdAt: request.createdAt || toISO(),
      updatedAt: request.updatedAt || toISO(),
    }),
  });
}

/**
 * Updated to include inline details by sourcing from /api/requests-with-details.
 * This makes edit dialogs prefill immediately (and they still fetch latest in-dialog).
 */
export async function getRequestsByUser(email: string): Promise<Request[]> {
  await initDB();
  type Row = Request & { details: any | null; approvalsCount: number };
  const rows = await http<Row[]>("/api/requests-with-details");
  const filtered = rows.filter(
    (r) => (r.createdBy || "").toLowerCase() === email.toLowerCase()
  );
  // Keep existing return shape the rest of the app expects.
  return sortByDateDesc(filtered, "createdAt") as unknown as Request[];
}

export async function getAllRequests(): Promise<Request[]> {
  await initDB();
  const data = await http<Request[]>("/api/requests");
  return sortByDateDesc(data, "createdAt");
}

export async function getPendingRequestsForRole(
  role: string
): Promise<Request[]> {
  await initDB();
  const statusMap: Record<string, Request["status"]> = {
    secretary: "pending-secretary",
    siva: "pending-siva",
    raghu: "pending-raghu",
    manoj: "pending-manoj",
  };
  const status = statusMap[role];
  if (!status) return [];
  const q = new URLSearchParams({ status });
  const data = await http<Request[]>(`/api/requests?${q.toString()}`);
  return sortByDateDesc(data, "createdAt");
}

export const updateRequestStatus = async (
  requestId: string,
  status: Request["status"]
): Promise<void> => {
  await initDB();
  await http(`/api/requests/${encodeURIComponent(requestId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
};

/* ================================
   Versioned details
   ================================ */

export async function savePlantCodeDetails(details: PlantCodeDetails) {
  await initDB();
  await http("/api/plant-details", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export async function saveCompanyCodeDetails(details: CompanyCodeDetails) {
  await initDB();
  await http("/api/company-details", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export async function getLatestRequestDetails(
  requestId: string,
  type: "plant" | "company"
) {
  await initDB();
  if (type === "plant") {
    return await http<PlantCodeDetails | null>(
      `/api/plant-details/${encodeURIComponent(requestId)}/latest`
    );
  } else {
    return await http<CompanyCodeDetails | null>(
      `/api/company-details/${encodeURIComponent(requestId)}/latest`
    );
  }
}

/** Fetch all versions (DESC by version on server) for change highlighting */
export async function getAllRequestDetailsVersions(
  requestId: string,
  type: "plant" | "company"
): Promise<Array<PlantCodeDetails | CompanyCodeDetails>> {
  await initDB();
  if (type === "plant") {
    const rows = await http<PlantCodeDetails[]>(
      `/api/plant-details/${encodeURIComponent(requestId)}`
    );
    return rows || [];
  } else {
    const rows = await http<CompanyCodeDetails[]>(
      `/api/company-details/${encodeURIComponent(requestId)}`
    );
    return rows || [];
  }
}

/* ================================
   Approvals & History
   ================================ */

export async function saveApproval(approval: Approval) {
  await initDB();
  await http("/api/approvals", {
    method: "POST",
    body: JSON.stringify(approval),
  });
}

export const addApproval = async (
  requestId: string,
  approverEmail: string,
  role: string,
  decision: "approve" | "reject",
  comment: string,
  attachmentId?: string
): Promise<void> => {
  await initDB();
  const timestamp = toISO();
  await http("/api/approvals", {
    method: "POST",
    body: JSON.stringify({
      requestId,
      approverEmail,
      role,
      decision,
      comment,
      attachmentId,
      timestamp,
    }),
  });

  // Also log the action (for analytics & audit)
  await http("/api/history", {
    method: "POST",
    body: JSON.stringify({
      requestId,
      action: decision === "approve" ? "approve" : "reject",
      user: approverEmail,
      timestamp,
      metadata: { comment, role, decision },
    }),
  });
};

export async function getApprovalsForRequest(
  requestId: string
): Promise<Approval[]> {
  await initDB();
  const data = await http<Approval[]>(
    `/api/approvals/${encodeURIComponent(requestId)}`
  );
  return [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function saveHistoryLog(log: HistoryLog) {
  await initDB();
  await http("/api/history", {
    method: "POST",
    body: JSON.stringify(log),
  });
}

export async function getHistoryForRequest(
  requestId: string
): Promise<HistoryLog[]> {
  await initDB();
  const data = await http<HistoryLog[]>(
    `/api/history/${encodeURIComponent(requestId)}`
  );
  return sortByDateDesc(data, "timestamp");
}

/* ================================
   Attachments
   ================================ */

export const uploadAttachment = async (args: {
  requestId: string;
  fileName: string;
  fileType: string;
  fileContent: string; // base64 or data URL
  version: number;
  title?: string;
  uploadedBy: string;
}): Promise<{ attachmentId: string }> => {
  await initDB();
  const res = await http<{ attachmentId: string }>("/api/attachments", {
    method: "POST",
    body: JSON.stringify(args),
  });
  return res;
};

export const getAttachmentsForRequest = async (
  requestId: string
): Promise<Omit<Attachment, "fileContent">[]> => {
  await initDB();
  const data = await http<
    Array<{
      attachmentId: string;
      requestId: string;
      fileName: string;
      fileType: string;
      version: number;
      title: string | null;
      uploadedBy: string;
      uploadedAt: string;
    }>
  >(`/api/attachments/${encodeURIComponent(requestId)}`);
  // Normalize to Attachment minus fileContent
  return data.map((d) => ({
    attachmentId: d.attachmentId,
    requestId: d.requestId,
    fileName: d.fileName,
    fileType: d.fileType,
    version: d.version,
    title: d.title || "",
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
  }));
};

/** Fetches attachment binary and returns a data URL you can feed into your DocumentViewer. */
export const getAttachmentDataUrl = async (
  attachmentId: string
): Promise<string> => {
  await initDB();
  const resp = await fetch(
    `${API_BASE}/api/attachment/${encodeURIComponent(attachmentId)}`,
    { method: "GET" }
  );
  if (!resp.ok) throw new Error(`Failed to fetch attachment ${attachmentId}`);
  const blob = await resp.blob();
  return await blobToDataUrl(blob);
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/* ================================
   Aggregation & analytics
   ================================ */

export const getRequestsWithDetails = async (): Promise<
  Array<{
    id: string;
    type: Request["type"];
    status: Request["status"];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    details: any;
    approvals: any[]; // you can enrich with getApprovalsForRequest if needed
  }>
> => {
  await initDB();
  // Server returns joined Requests + latest details + approvalsCount
  const rows = await http<
    Array<
      Request & {
        details: any | null;
        approvalsCount: number;
      }
    >
  >("/api/requests-with-details");

  // Conform to the shape your dashboards expect (id instead of requestId, include approvals array empty by default)
  return rows.map((r) => ({
    id: r.requestId,
    type: r.type,
    status: r.status,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    details: r.details || {},
    approvals: [], // fetch separately if/when needed for a given request
  }));
};

/* ================================
   Completion utilities (compat)
   ================================ */

export const markRequestCompleted = async (
  requestId: string,
  completedBy: string
): Promise<void> => {
  await initDB();
  // Get the request to compute turnaround
  let req: Request | null = null;
  try {
    req = await http<Request>(`/api/requests/${encodeURIComponent(requestId)}`);
  } catch {
    // ignore
  }

  const completedAt = toISO();
  await updateRequestStatus(requestId, "completed");

  if (req?.createdAt) {
    const createdDate = new Date(req.createdAt);
    const completedDate = new Date(completedAt);
    const turnaroundTime = Math.ceil(
      (completedDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Record in history
    await saveHistoryLog({
      requestId,
      action: "update-sap",
      user: completedBy,
      timestamp: completedAt,
      metadata: { turnaroundTime, completedBy },
    });
  }
};

export const getCompletedRequests = async (): Promise<Request[]> => {
  await initDB();
  const q = new URLSearchParams({ status: "completed" });
  const data = await http<Request[]>(`/api/requests?${q.toString()}`);
  // If server doesn’t compute completedAt, use updatedAt
  return [...data].sort(
    (a, b) =>
      new Date(b.completedAt || b.updatedAt).getTime() -
      new Date(a.completedAt || a.updatedAt).getTime()
  );
};

/* ================================
   Generators (kept from prior)
   ================================ */

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateRequestId(): string {
  return `REQ-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}

/* ================================
   Master code lookups
   ================================ */

export interface PlantCodeMaster {
  companyCode: string;
  plantCode: string;
  gstCertificate: string | null;
  nameOfPlant: string;
  addressOfPlant: string | null;
  purchaseOrganization: string | null;
  nameOfPurchaseOrganization: string | null;
  salesOrganization: string | null;
  nameOfSalesOrganization: string | null;
  profitCenter: string | null;
  nameOfProfitCenter: string | null;
  costCenters: string | null;
  nameOfCostCenters: string | null;
  projectCode: string | null;
  projectCodeDescription: string | null;
  storageLocationCode: string | null;
  storageLocationDescription: string | null;
}

export interface CompanyCodeMaster {
  companyCode: string;
  nameOfCompanyCode: string;
  shareholdingPercentage: number | null;
  segment: string | null;
  nameOfSegment: string | null;
  cin: string | null;
  pan: string | null;
  gstCertificate: string | null;
}

export async function getMasterPlantCodes(opts?: {
  q?: string;
  companyCode?: string;
  plantCode?: string;
  limit?: number;
  offset?: number;
}): Promise<PlantCodeMaster[]> {
  await initDB();
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.companyCode) params.set("companyCode", opts.companyCode);
  if (opts?.plantCode) params.set("plantCode", opts.plantCode);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  return await http<PlantCodeMaster[]>(
    `/api/master/plant-codes${params.toString() ? `?${params.toString()}` : ""}`
  );
}

export async function getMasterCompanyCodes(opts?: {
  q?: string;
  companyCode?: string;
  limit?: number;
  offset?: number;
}): Promise<CompanyCodeMaster[]> {
  await initDB();
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.companyCode) params.set("companyCode", opts.companyCode);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  return await http<CompanyCodeMaster[]>(
    `/api/master/company-codes${
      params.toString() ? `?${params.toString()}` : ""
    }`
  );
}
