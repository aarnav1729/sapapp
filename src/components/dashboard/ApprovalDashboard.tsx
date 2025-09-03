import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DocumentViewer } from "@/components/ui/document-viewer";
import {
  getRequestsWithDetails,
  addApproval,
  updateRequestStatus,
  getHistoryForRequest,
  getAttachmentsForRequest, // ⬅️ NEW
  getAttachmentDataUrl, // ⬅️ NEW
} from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Search,
  Eye,
  MessageSquare,
  Calendar,
  User,
  Paperclip, // ⬅️ NEW
  Download, // ⬅️ NEW
} from "lucide-react";

interface Request {
  id: string;
  type: "plant" | "company";
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  details: any;
  approvals: any[];
}

type AttachmentMeta = {
  attachmentId: string;
  requestId: string;
  fileName: string;
  fileType: string;
  version: number;
  title: string;
  uploadedBy: string;
  uploadedAt: string;
};

interface ApprovalDashboardProps {
  userEmail: string;
  userRole: string;
}

export function ApprovalDashboard({
  userEmail,
  userRole,
}: ApprovalDashboardProps) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [approvalComment, setApprovalComment] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [requestHistory, setRequestHistory] = useState<any[]>([]);
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
  // ⬇️ NEW: central attachments modal state
  const [attachmentsModal, setAttachmentsModal] = useState<{
    open: boolean;
    request: Request | null;
    items: AttachmentMeta[];
    loading: boolean;
  }>({ open: false, request: null, items: [], loading: false });

  const { toast } = useToast();

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const requestsData = await getRequestsWithDetails();
      setRequests(requestsData);
    } catch (error) {
      console.error("Failed to load requests:", error);
      toast({
        title: "Error",
        description: "Failed to load requests",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getNextStatus = (
    currentStatus: string,
    decision: "approve" | "reject"
  ) => {
    if (decision === "reject") return "rejected";

    const approvalFlow = {
      "pending-secretary": "pending-siva",
      "pending-siva": "pending-raghu",
      "pending-raghu": "pending-manoj",
      "pending-manoj": "approved",
    };

    return (
      approvalFlow[currentStatus as keyof typeof approvalFlow] || currentStatus
    );
  };

  const canApprove = (request: Request) => {
    const statusRoleMap = {
      "pending-secretary": "secretary",
      "pending-siva": "siva",
      "pending-raghu": "raghu",
      "pending-manoj": "manoj",
    };

    return (
      statusRoleMap[request.status as keyof typeof statusRoleMap] === userRole
    );
  };

  const handleApproval = async (
    requestId: string,
    decision: "approve" | "reject"
  ) => {
    if (!approvalComment.trim()) {
      toast({
        title: "Error",
        description: "Please add a comment for your decision",
        variant: "destructive",
      });
      return;
    }

    setIsApproving(true);
    try {
      const request = requests.find((r) => r.id === requestId);
      if (!request) return;

      await addApproval(
        requestId,
        userEmail,
        userRole,
        decision,
        approvalComment
      );

      const nextStatus = getNextStatus(request.status, decision);
      await updateRequestStatus(requestId, nextStatus);

      setApprovalComment("");
      setSelectedRequest(null);
      await loadRequests();

      toast({
        title: "Success",
        description: `Request ${decision}d successfully`,
        variant: "default",
      });
    } catch (error) {
      console.error("Failed to process approval:", error);
      toast({
        title: "Error",
        description: "Failed to process approval",
        variant: "destructive",
      });
    } finally {
      setIsApproving(false);
    }
  };

  const loadRequestHistory = async (requestId: string) => {
    try {
      const history = await getHistoryForRequest(requestId);
      setRequestHistory(history);
    } catch (error) {
      console.error("Failed to load request history:", error);
    }
  };

  const filteredRequests = requests.filter(
    (request) =>
      request.details?.companyCode
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      request.details?.plantCode
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      request.createdBy.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingRequests = filteredRequests.filter((request) =>
    canApprove(request)
  );
  const allRequests = filteredRequests;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending-secretary":
        return "warning";
      case "pending-siva":
        return "secondary";
      case "pending-raghu":
        return "secondary";
      case "pending-manoj":
        return "secondary";
      case "approved":
        return "success";
      case "rejected":
        return "destructive";
      case "completed":
        return "success";
      default:
        return "secondary";
    }
  };

  const getStatusDisplay = (status: string) => {
    const statusMap = {
      "pending-secretary": "Secretarial Review",
      "pending-siva": "Finance Approver 1 Review",
      "pending-raghu": "Finance Approver 2 Review",
      "pending-manoj": "Finance Approver 3 Review",
      approved: "Approved",
      rejected: "Rejected",
      completed: "Completed",
    };
    return statusMap[status as keyof typeof statusMap] || status;
  };

  const getRoleDisplay = (role: string) => {
    const roleMap = {
      secretary: "Secretarial",
      siva: "Finance Approver 1",
      raghu: "Finance Approver 2",
      manoj: "Finance Approver 3",
    };
    return roleMap[role as keyof typeof roleMap] || role;
  };

  // ⬇️ NEW: attachments helpers
  const openAttachments = async (req: Request) => {
    setAttachmentsModal({ open: true, request: req, items: [], loading: true });
    try {
      const items = await getAttachmentsForRequest(req.id);
      setAttachmentsModal((p) => ({
        ...p,
        items: items as AttachmentMeta[],
        loading: false,
      }));
    } catch (e) {
      setAttachmentsModal((p) => ({ ...p, loading: false }));
      toast({
        title: "Error",
        description: "Failed to load attachments",
        variant: "destructive",
      });
    }
  };

  const viewAttachment = async (att: AttachmentMeta) => {
    try {
      const dataUrl = await getAttachmentDataUrl(att.attachmentId);
      setDocumentViewer({
        open: true,
        fileName: att.fileName,
        fileContent: dataUrl,
        fileType: att.fileType,
      });
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to open the document",
        variant: "destructive",
      });
    }
  };

  const downloadAttachment = async (att: AttachmentMeta) => {
    try {
      const dataUrl = await getAttachmentDataUrl(att.attachmentId);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = att.fileName || "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to download the document",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Approval Dashboard
          </h1>
          <p className="text-muted-foreground">
            Review and approve code creation requests
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          {getRoleDisplay(userRole)}
        </Badge>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending My Review
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingRequests.length}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting your approval
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Requests
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{requests.length}</div>
            <p className="text-xs text-muted-foreground">
              All requests in system
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Approved Today
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {
                requests.filter((r) => {
                  const hasMyApproval = r.approvals?.some(
                    (a) =>
                      a.approverEmail === userEmail &&
                      a.decision === "approve" &&
                      new Date(a.timestamp).toDateString() ===
                        new Date().toDateString()
                  );
                  return hasMyApproval;
                }).length
              }
            </div>
            <p className="text-xs text-muted-foreground">By you today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg. Review Time
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1.5</div>
            <p className="text-xs text-muted-foreground">Days average</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">
            Pending My Review ({pendingRequests.length})
          </TabsTrigger>
          <TabsTrigger value="all">All Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {/* Search */}
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code, requestor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardContent>
          </Card>

          {/* Pending Requests */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Requests Awaiting Your Approval
              </CardTitle>
              <CardDescription>
                Review and approve/reject these requests
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingRequests.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium">All caught up!</h3>
                  <p className="text-muted-foreground">
                    No requests pending your approval.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Requestor</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-mono">
                          {request.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {request.type === "plant"
                              ? "Plant Code"
                              : "Company Code"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {request.details?.plantCode ||
                            request.details?.companyCode ||
                            "N/A"}
                        </TableCell>
                        <TableCell>{request.createdBy}</TableCell>
                        <TableCell>
                          {new Date(request.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(request.status)}>
                            {getStatusDisplay(request.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openAttachments(request)}
                              aria-label="View documents"
                              title="View / download documents"
                            >
                              <Paperclip className="h-4 w-4" />
                            </Button>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    loadRequestHistory(request.id);
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  Review
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Review Request</DialogTitle>
                                  <DialogDescription>
                                    {request.type === "plant"
                                      ? "Plant Code"
                                      : "Company Code"}{" "}
                                    Request #{request.id.slice(0, 8)}
                                  </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-2 gap-6">
                                  {/* Request Details */}
                                  <div className="space-y-4">
                                    <h4 className="font-medium">
                                      Request Details
                                    </h4>
                                    <div className="space-y-3">
                                      {Object.entries(
                                        request.details || {}
                                      ).map(([key, value]) => (
                                        <div key={key}>
                                          <Label className="text-sm font-medium capitalize">
                                            {key
                                              .replace(/([A-Z])/g, " $1")
                                              .toLowerCase()}
                                          </Label>
                                          <p className="text-sm text-muted-foreground mt-1">
                                            {value as string}
                                          </p>
                                        </div>
                                      ))}
                                    </div>

                                    {/* Previous Approvals */}
                                    {request.approvals &&
                                      request.approvals.length > 0 && (
                                        <div>
                                          <h4 className="font-medium mb-2">
                                            Previous Approvals
                                          </h4>
                                          <div className="space-y-2">
                                            {request.approvals.map(
                                              (approval, index) => (
                                                <div
                                                  key={index}
                                                  className="flex items-center justify-between p-3 bg-muted rounded"
                                                >
                                                  <div className="flex items-center space-x-3">
                                                    <Badge
                                                      variant={
                                                        approval.decision ===
                                                        "approve"
                                                          ? "success"
                                                          : "destructive"
                                                      }
                                                    >
                                                      {approval.decision}
                                                    </Badge>
                                                    <div>
                                                      <p className="text-sm font-medium">
                                                        {approval.approverEmail}
                                                      </p>
                                                      <p className="text-xs text-muted-foreground">
                                                        {approval.comment}
                                                      </p>
                                                    </div>
                                                  </div>
                                                  <span className="text-xs text-muted-foreground">
                                                    {new Date(
                                                      approval.timestamp
                                                    ).toLocaleDateString()}
                                                  </span>
                                                </div>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      )}

                                    {/* Request History */}
                                    {requestHistory.length > 0 && (
                                      <div>
                                        <h4 className="font-medium mb-2">
                                          Request History
                                        </h4>
                                        <div className="space-y-2">
                                          {requestHistory.map(
                                            (history, index) => (
                                              <div
                                                key={index}
                                                className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                                              >
                                                <div>
                                                  <span className="font-medium">
                                                    {history.action}
                                                  </span>
                                                  <span className="text-muted-foreground ml-2">
                                                    by {history.user}
                                                  </span>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                  {new Date(
                                                    history.timestamp
                                                  ).toLocaleString()}
                                                </span>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Approval Form */}
                                  <div className="space-y-4">
                                    <h4 className="font-medium">
                                      Your Decision
                                    </h4>
                                    <div className="space-y-4">
                                      <div>
                                        <Label htmlFor="comment">
                                          Comment *
                                        </Label>
                                        <Textarea
                                          id="comment"
                                          value={approvalComment}
                                          onChange={(e) =>
                                            setApprovalComment(e.target.value)
                                          }
                                          placeholder="Add your comments about this request..."
                                          className="mt-1"
                                          rows={4}
                                        />
                                      </div>

                                      <div className="flex space-x-2">
                                        <Button
                                          variant="outline"
                                          className="flex-1"
                                          onClick={() =>
                                            handleApproval(request.id, "reject")
                                          }
                                          disabled={isApproving}
                                        >
                                          <XCircle className="h-4 w-4 mr-2" />
                                          Reject
                                        </Button>
                                        <Button
                                          className="flex-1"
                                          onClick={() =>
                                            handleApproval(
                                              request.id,
                                              "approve"
                                            )
                                          }
                                          disabled={isApproving}
                                        >
                                          <CheckCircle className="h-4 w-4 mr-2" />
                                          Approve
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          {/* Search */}
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code, requestor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardContent>
          </Card>

          {/* All Requests */}
          <Card>
            <CardHeader>
              <CardTitle>All Requests</CardTitle>
              <CardDescription>
                Complete history of all requests in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Requestor</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Documents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-mono">
                        {request.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {request.type === "plant"
                            ? "Plant Code"
                            : "Company Code"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {request.details?.plantCode ||
                          request.details?.companyCode ||
                          "N/A"}
                      </TableCell>
                      <TableCell>{request.createdBy}</TableCell>
                      <TableCell>
                        {new Date(request.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {new Date(request.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(request.status)}>
                          {getStatusDisplay(request.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {" "}
                        {/* ⬅️ NEW */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openAttachments(request)}
                          aria-label="View documents"
                          title="View / download documents"
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* NEW: Attachments Modal (single, reused for any row) */}
      <Dialog
        open={attachmentsModal.open}
        onOpenChange={(open) => setAttachmentsModal((p) => ({ ...p, open }))}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-5 w-5" />
              {attachmentsModal.request
                ? `Attachments • ${
                    attachmentsModal.request.details?.plantCode ||
                    attachmentsModal.request.details?.companyCode ||
                    attachmentsModal.request.id.slice(0, 8)
                  }`
                : "Attachments"}
            </DialogTitle>
            <DialogDescription>
              View or download documents attached to this request.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {attachmentsModal.loading ? (
              <div className="text-sm text-muted-foreground">
                Loading documents…
              </div>
            ) : attachmentsModal.items.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No documents attached.
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {attachmentsModal.items.map((att) => (
                  <div
                    key={att.attachmentId}
                    className="flex items-center justify-between p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{att.fileName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {att.title ? `${att.title} • ` : ""}
                        Uploaded by {att.uploadedBy} on{" "}
                        {new Date(att.uploadedAt).toLocaleString()} • v
                        {att.version}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => viewAttachment(att)}
                        title="View"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadAttachment(att)}
                        title="Download"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <DocumentViewer
        open={documentViewer.open}
        onOpenChange={(open) =>
          setDocumentViewer((prev) => ({ ...prev, open }))
        }
        fileName={documentViewer.fileName}
        fileContent={documentViewer.fileContent}
        fileType={documentViewer.fileType}
      />
    </div>
  );
}
