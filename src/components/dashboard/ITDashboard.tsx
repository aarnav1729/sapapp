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
import { Textarea } from "@/components/ui/textarea";
import {
  getRequestsWithDetails,
  updateRequestStatus,
  addApproval,
  // ⬇️ NEW: attachments API
  getAttachmentsForRequest,
  getAttachmentDataUrl,
} from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { DocumentViewer } from "@/components/ui/document-viewer";
import { RequestDetailsDialog } from "@/components/dialogs/RequestDetailsDialog";
import {
  Database,
  CheckCircle,
  Clock,
  FileText,
  Search,
  Eye,
  Activity,
  TrendingUp,
  Paperclip,
  Download,
} from "lucide-react";

interface RequestRow {
  id: string; // requestId mirrored for table
  requestId?: string; // ensure dialog compatibility
  title?: string;
  version?: number;
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

export function ITDashboard({ userEmail }: { userEmail: string }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(
    null
  );
  const [sapUpdateNote, setSapUpdateNote] = useState("");
  const [viewingRequest, setViewingRequest] = useState<RequestRow | null>(null);

  // Existing viewer
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
    request: RequestRow | null;
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
      setRequests(requestsData.map((r) => ({ ...r, requestId: r.id })));
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

  const handleSAPUpdate = async (requestId: string) => {
    if (!sapUpdateNote.trim()) {
      toast({
        title: "Error",
        description: "Please add an update note",
        variant: "destructive",
      });
      return;
    }

    try {
      await addApproval(requestId, userEmail, "it", "approve", sapUpdateNote);
      await updateRequestStatus(requestId, "sap-updated");
      setSapUpdateNote("");
      setSelectedRequest(null);
      await loadRequests();

      toast({
        title: "Success",
        description: "SAP update recorded successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Failed to update SAP status:", error);
      toast({
        title: "Error",
        description: "Failed to update SAP status",
        variant: "destructive",
      });
    }
  };

  // ⬇️ NEW: attachments helpers
  const openAttachments = async (req: RequestRow) => {
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

  const filteredRequests = requests.filter(
    (request) =>
      (request.details?.companyCode?.toLowerCase() || "").includes(
        searchTerm.toLowerCase()
      ) ||
      (request.details?.plantCode?.toLowerCase() || "").includes(
        searchTerm.toLowerCase()
      ) ||
      (request.createdBy || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const approvedRequests = filteredRequests.filter(
    (r) => r.status === "approved"
  );
  const updatedRequests = filteredRequests.filter(
    (r) => r.status === "sap-updated"
  );
  const recentActivity = [...filteredRequests]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "success";
      case "sap-updated":
        return "default";
      case "pending":
        return "warning";
      case "rejected":
        return "destructive";
      default:
        return "secondary";
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
          <h1 className="text-3xl font-bold tracking-tight">IT Dashboard</h1>
          <p className="text-muted-foreground">
            SAP updates and system maintenance
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending SAP Updates
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvedRequests.length}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting SAP implementation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Completed Updates
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{updatedRequests.length}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 inline mr-1" />
              SAP updated successfully
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Requests
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
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
              Avg. Processing
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2.3</div>
            <p className="text-xs text-muted-foreground">Days to SAP update</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending SAP Updates</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
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

          {/* Pending Updates Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Pending SAP Updates ({approvedRequests.length})
              </CardTitle>
              <CardDescription>
                Requests approved by all stakeholders, ready for SAP
                implementation
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
                    <TableHead>Approved Date</TableHead>
                    <TableHead>Expected Time</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedRequests.map((request) => (
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
                        {new Date(request.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning">
                          {request.type === "plant" ? "2 days" : "10 days"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* View details */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setViewingRequest({
                                ...request,
                                requestId: request.id,
                              });
                            }}
                            aria-label="View request details"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {/* NEW: attachments button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openAttachments(request)}
                            aria-label="View documents"
                            title="View / download documents"
                          >
                            <Paperclip className="h-4 w-4" />
                          </Button>

                          {/* Update SAP */}
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                onClick={() => setSelectedRequest(request)}
                              >
                                <Database className="h-4 w-4 mr-2" />
                                Update SAP
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>
                                  Mark as Updated in SAP
                                </DialogTitle>
                                <DialogDescription>
                                  Record that this request has been implemented
                                  in SAP system.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-sm font-medium">
                                    Update Notes
                                  </label>
                                  <Textarea
                                    value={sapUpdateNote}
                                    onChange={(e) =>
                                      setSapUpdateNote(e.target.value)
                                    }
                                    placeholder="Describe what was updated in SAP..."
                                    className="mt-1"
                                  />
                                </div>
                                <div className="flex justify-end space-x-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => setSelectedRequest(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    onClick={() => handleSAPUpdate(request.id)}
                                  >
                                    Mark as Updated
                                  </Button>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Completed SAP Updates ({updatedRequests.length})
              </CardTitle>
              <CardDescription>
                Requests that have been successfully implemented in SAP
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
                    <TableHead>Updated Date</TableHead>
                    <TableHead>Status</TableHead>
                    {/* NEW: docs column */}
                    <TableHead className="text-right">Documents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {updatedRequests.map((request) => (
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
                        {new Date(request.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">SAP Updated</Badge>
                      </TableCell>
                      {/* NEW: docs button */}
                      <TableCell className="text-right">
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

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Recent Activity
              </CardTitle>
              <CardDescription>
                Latest updates and changes in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentActivity.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="bg-primary/10 p-2 rounded-full">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {request.type === "plant"
                            ? "Plant Code"
                            : "Company Code"}{" "}
                          Request Updated
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {request.details?.plantCode ||
                            request.details?.companyCode ||
                            "—"}{" "}
                          by {request.createdBy}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={getStatusColor(request.status)}>
                        {request.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(request.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Request Details Dialog */}
      {viewingRequest && (
        <RequestDetailsDialog
          request={viewingRequest as any}
          open={!!viewingRequest}
          onOpenChange={(open) => !open && setViewingRequest(null)}
        />
      )}

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

      {/* Document Viewer (reused) */}
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
