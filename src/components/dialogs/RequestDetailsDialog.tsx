import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentViewer } from "@/components/ui/document-viewer";
import {
  FileText,
  Clock,
  User,
  Building2,
  AlertCircle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  Request,
  PlantCodeDetails,
  CompanyCodeDetails,
  Approval,
  HistoryLog,
  Attachment,
  getLatestRequestDetails,
  getApprovalsForRequest,
  getHistoryForRequest,
  getAllRequestDetailsVersions,
  getAttachmentsForRequest,
  getAttachmentDataUrl,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { compareObjects, CompareResult } from "@/lib/changeTracking";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

interface RequestDetailsDialogProps {
  request: Request | (Request & { id?: string }); // accept either shape
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestDetailsDialog({
  request,
  open,
  onOpenChange,
}: RequestDetailsDialogProps) {
  const [details, setDetails] = useState<
    PlantCodeDetails | CompanyCodeDetails | null
  >(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [history, setHistory] = useState<HistoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<
    Array<PlantCodeDetails | CompanyCodeDetails>
  >([]);
  const [attachments, setAttachments] = useState<
    Array<Omit<Attachment, "fileContent">>
  >([]);

  const [documentViewer, setDocumentViewer] = useState<{
    open: boolean;
    fileName: string;
    fileContent: string;
    fileType: string;
  }>({
    open: false,
    fileName: "",
    fileContent: "",
    fileType: "",
  });

  // Robustly resolve the requestId no matter the caller shape
  const requestId = useMemo(() => {
    // Some callers pass .requestId, others only .id; prefer request.requestId, fallback to id
    return (request as any)?.requestId || (request as any)?.id;
  }, [request]);

  useEffect(() => {
    if (open && request && requestId) {
      loadRequestData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request, requestId]);

  const loadRequestData = async () => {
    setLoading(true);
    try {
      const [
        requestDetails,
        requestApprovals,
        requestHistory,
        allVersions,
        requestAttachments,
      ] = await Promise.all([
        getLatestRequestDetails(requestId, request.type),
        getApprovalsForRequest(requestId),
        getHistoryForRequest(requestId),
        getAllRequestDetailsVersions(requestId, request.type),
        getAttachmentsForRequest(requestId),
      ]);

      setDetails(requestDetails);
      setApprovals(requestApprovals);
      setHistory(requestHistory);
      setVersions(allVersions || []);
      setAttachments(requestAttachments || []);
    } catch (error) {
      console.error("Error loading request data:", error);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  // Ensure we always compare the correct versions regardless of server ordering
  const sortedVersions = useMemo(
    () =>
      [...versions].sort(
        (a, b) =>
          Number((b as any)?.version ?? 0) - Number((a as any)?.version ?? 0)
      ),
    [versions]
  );

  // Derive diff from versions with a stable memoized computation (race-free)
  const diff: CompareResult = useMemo(() => {
    if (sortedVersions.length >= 2) {
      const latest = sortedVersions[0];
      const prev = sortedVersions[1];
      return compareObjects(prev, latest, request.type);
    }
    return { hasChanges: false, changes: [], changedFields: [] };
  }, [sortedVersions, request.type]);

  // Set for O(1) highlight checks
  const changedFieldsSet = useMemo(
    () => new Set(diff.changedFields || []),
    [diff.changedFields]
  );

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      draft: { label: "Draft", variant: "secondary" as const, icon: FileText },
      "pending-secretary": {
        label: "Pending Secretarial",
        variant: "warning" as const,
        icon: Clock,
      },
      "pending-siva": {
        label: "Pending Finance Approver 1",
        variant: "warning" as const,
        icon: Clock,
      },
      "pending-raghu": {
        label: "Pending Finance Approver 2",
        variant: "warning" as const,
        icon: Clock,
      },
      "pending-manoj": {
        label: "Pending Finance Approver 3",
        variant: "warning" as const,
        icon: Clock,
      },

      approved: {
        label: "Approved",
        variant: "success" as const,
        icon: CheckCircle,
      },
      rejected: {
        label: "Rejected",
        variant: "destructive" as const,
        icon: XCircle,
      },
      "sap-updated": {
        label: "SAP Updated",
        variant: "success" as const,
        icon: CheckCircle,
      },
    };

    const config = (statusConfig as any)[status] || {
      label: status,
      variant: "secondary" as const,
      icon: AlertCircle,
    };

    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getActionIcon = (action: string) => {
    const icons = {
      create: FileText,
      edit: FileText,
      approve: CheckCircle,
      reject: XCircle,
      "update-sap": Building2,
    };
    return (icons as any)[action] || AlertCircle;
  };

  const isChanged = (field: string) => changedFieldsSet.has(field);

  const openAttachment = async (att: Omit<Attachment, "fileContent">) => {
    try {
      const dataUrl = await getAttachmentDataUrl(att.attachmentId);
      setDocumentViewer({
        open: true,
        fileName: att.fileName || att.title || "document",
        fileContent: dataUrl,
        fileType: att.fileType,
      });
    } catch (e) {
      console.error("Failed to load attachment:", e);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <VisuallyHidden>
            <DialogTitle>Loading request details…</DialogTitle>
          </VisuallyHidden>
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">
              Loading request details...
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {request.title}
              </DialogTitle>
              <DialogDescription className="mt-2">
                Request ID: {requestId} • Created by: {request.createdBy}
              </DialogDescription>
            </div>
            {getStatusBadge(request.status)}
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">Request Details</TabsTrigger>
            <TabsTrigger value="approvals">Approval History</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          {/* Change Summary when multiple versions exist */}
          {diff?.hasChanges && (
            <Card className="border-amber-300 bg-amber-50">
              <CardHeader>
                <CardTitle className="text-amber-900">
                  Changes in Latest Version
                </CardTitle>
                <CardDescription>
                  Comparing version {(sortedVersions[1] as any)?.version} →{" "}
                  {(sortedVersions[0] as any)?.version}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {diff.changes.map((c) => (
                    <li key={c.field}>
                      <span className="font-medium">{c.label}</span>: “
                      {String(c.oldValue ?? "—")}” → “
                      {String(c.newValue ?? "—")}”
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {request.type === "plant"
                    ? "Plant Code Details"
                    : "Company Code Details"}
                </CardTitle>
                <CardDescription>
                  Version {details ? (details as any).version : "—"} • Last
                  updated: {new Date(request.updatedAt).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {details ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {request.type === "plant" ? (
                      <>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("companyCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Company Code
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).companyCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("plantCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Plant Code
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).plantCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfPlant")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Plant
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).nameOfPlant || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("gstNumber")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            GST Number
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).gstNumber || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("gstCertificate")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            GST Certificate
                          </label>
                          <p className="text-sm break-all">
                            {(details as PlantCodeDetails).gstCertificate ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("purchaseOrganization")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Purchase Organization
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .purchaseOrganization || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("salesOrganization")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Sales Organization
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).salesOrganization ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("profitCenter")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Profit Center
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).profitCenter || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border md:col-span-2 ${
                            isChanged("addressOfPlant")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Address of Plant
                          </label>
                          <p className="text-sm whitespace-pre-wrap">
                            {(details as PlantCodeDetails).addressOfPlant ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfPurchaseOrganization")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Purchase Organization
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .nameOfPurchaseOrganization || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfSalesOrganization")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Sales Organization
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .nameOfSalesOrganization || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfProfitCenter")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Profit Center
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).nameOfProfitCenter ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("costCenters")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Cost Centers
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).costCenters || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfCostCenters")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Cost Centers
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).nameOfCostCenters ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("projectCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Project Code
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails).projectCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("projectCodeDescription")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Project Code Description
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .projectCodeDescription || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("storageLocationCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Storage Location Code
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .storageLocationCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("storageLocationDescription")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Storage Location Description
                          </label>
                          <p className="text-sm">
                            {(details as PlantCodeDetails)
                              .storageLocationDescription || "—"}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("companyCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Company Code
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).companyCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfCompanyCode")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Company Name
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails)
                              .nameOfCompanyCode || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("shareholdingPercentage")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Shareholding %
                          </label>
                          <p className="text-sm">
                            {typeof (details as CompanyCodeDetails)
                              .shareholdingPercentage === "number"
                              ? `${
                                  (details as CompanyCodeDetails)
                                    .shareholdingPercentage
                                }%`
                              : "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("segment")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Segment
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).segment || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("gstNumber")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            GST Number
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).gstNumber || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("gstCertificate")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            GST Certificate
                          </label>
                          <p className="text-sm break-all">
                            {(details as CompanyCodeDetails).gstCertificate ||
                              "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("cinNumber")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            CIN Number
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).cinNumber || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("cin")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            CIN
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).cin || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("panNumber")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            PAN Number
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).panNumber || "—"}
                          </p>
                        </div>

                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("pan")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            PAN
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).pan || "—"}
                          </p>
                        </div>
                        <div
                          className={`space-y-1 rounded-lg p-2 border ${
                            isChanged("nameOfSegment")
                              ? "bg-amber-50 border-amber-300"
                              : "border-transparent"
                          }`}
                        >
                          <label className="text-sm font-medium text-muted-foreground">
                            Name of Segment
                          </label>
                          <p className="text-sm">
                            {(details as CompanyCodeDetails).nameOfSegment ||
                              "—"}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No details available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approvals" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Approval History</CardTitle>
                <CardDescription>
                  Track of all approval decisions for this request
                </CardDescription>
              </CardHeader>
              <CardContent>
                {approvals.length > 0 ? (
                  <div className="space-y-4">
                    {approvals.map((approval) => (
                      <div
                        key={`${approval.requestId}-${approval.approverEmail}`}
                        className="flex items-start space-x-3"
                      >
                        <div className="flex-shrink-0">
                          {approval.decision === "approve" ? (
                            <CheckCircle className="h-5 w-5 text-success" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">
                                {approval.approverEmail}
                              </span>
                              <Badge
                                variant={
                                  approval.decision === "approve"
                                    ? "success"
                                    : "destructive"
                                }
                              >
                                {approval.decision === "approve"
                                  ? "Approved"
                                  : "Rejected"}
                              </Badge>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {new Date(approval.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {approval.comment && (
                            <p className="text-sm text-muted-foreground">
                              {approval.comment}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No approvals yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Activity Log</CardTitle>
                <CardDescription>
                  Complete timeline of all activities for this request
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="space-y-4">
                    {history.map((log) => {
                      const Icon = getActionIcon(log.action);
                      return (
                        <div
                          key={`${log.requestId}-${log.timestamp}`}
                          className="flex items-start space-x-3"
                        >
                          <div className="flex-shrink-0">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium capitalize">
                                {log.action.replace("-", " ")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {new Date(log.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">
                                {log.user}
                              </span>
                            </div>
                            {log.metadata && (
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted p-2 rounded-md">
                                {typeof log.metadata === "string"
                                  ? log.metadata
                                  : JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No activity logged</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>
                  Files attached to this request
                </CardDescription>
              </CardHeader>
              <CardContent>
                {attachments.length > 0 ? (
                  <div className="space-y-3">
                    {attachments.map((att) => (
                      <div
                        key={att.attachmentId}
                        className="flex items-center justify-between p-3 border rounded-lg bg-background/50"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-primary" />
                          <div>
                            <div className="font-medium">
                              {att.title || att.fileName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {att.fileName} • v{att.version} •{" "}
                              {new Date(att.uploadedAt).toLocaleString()} •{" "}
                              {att.fileType}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" onClick={() => openAttachment(att)}>
                          View
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No documents uploaded</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>

      <DocumentViewer
        open={documentViewer.open}
        onOpenChange={(open) =>
          setDocumentViewer((prev) => ({ ...prev, open }))
        }
        fileName={documentViewer.fileName}
        fileContent={documentViewer.fileContent}
        fileType={documentViewer.fileType}
      />
    </Dialog>
  );
}
