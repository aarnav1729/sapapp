import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { DocumentViewer } from '@/components/ui/document-viewer';
import { 
  FileText, 
  Clock, 
  User, 
  Building2, 
  AlertCircle,
  CheckCircle,
  XCircle,
  Calendar
} from 'lucide-react';
import { 
  Request, 
  PlantCodeDetails, 
  CompanyCodeDetails,
  Approval,
  HistoryLog,
  getLatestRequestDetails,
  getApprovalsForRequest,
  getHistoryForRequest
} from '@/lib/storage';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

interface RequestDetailsDialogProps {
  request: Request;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestDetailsDialog({ request, open, onOpenChange }: RequestDetailsDialogProps) {
  const [details, setDetails] = useState<PlantCodeDetails | CompanyCodeDetails | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [history, setHistory] = useState<HistoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentViewer, setDocumentViewer] = useState<{
    open: boolean;
    fileName: string;
    fileContent: string;
    fileType: string;
  }>({
    open: false,
    fileName: '',
    fileContent: '',
    fileType: ''
  });

  useEffect(() => {
    if (open && request) {
      loadRequestData();
    }
  }, [open, request]);

  const loadRequestData = async () => {
    setLoading(true);
    try {
      const [requestDetails, requestApprovals, requestHistory] = await Promise.all([
        getLatestRequestDetails(request.requestId, request.type),
        getApprovalsForRequest(request.requestId),
        getHistoryForRequest(request.requestId)
      ]);

      setDetails(requestDetails);
      setApprovals(requestApprovals);
      setHistory(requestHistory);
    } catch (error) {
      console.error('Error loading request data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'draft': { label: 'Draft', variant: 'secondary' as const, icon: FileText },
      'pending-secretary': { label: 'Pending Secretary', variant: 'warning' as const, icon: Clock },
      'pending-finance': { label: 'Pending Finance', variant: 'warning' as const, icon: Clock },
      'pending-raghu': { label: 'Pending Raghu', variant: 'warning' as const, icon: Clock },
      'pending-siva': { label: 'Pending Siva', variant: 'warning' as const, icon: Clock },
      'approved': { label: 'Approved', variant: 'success' as const, icon: CheckCircle },
      'rejected': { label: 'Rejected', variant: 'destructive' as const, icon: XCircle },
      'sap-updated': { label: 'SAP Updated', variant: 'success' as const, icon: CheckCircle },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || { 
      label: status, 
      variant: 'secondary' as const, 
      icon: AlertCircle 
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
      'create': FileText,
      'edit': FileText,
      'approve': CheckCircle,
      'reject': XCircle,
      'update-sap': Building2,
    };
    return icons[action as keyof typeof icons] || AlertCircle;
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          {/* Ensure a DialogTitle is present even while loading */}
          <VisuallyHidden>
            <DialogTitle>Loading request details…</DialogTitle>
          </VisuallyHidden>
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading request details...</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-8xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {request.title}
              </DialogTitle>
              <DialogDescription className="mt-2">
                Request ID: {request.requestId} • Created by: {request.createdBy}
              </DialogDescription>
            </div>
            {getStatusBadge(request.status)}
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Request Details</TabsTrigger>
            <TabsTrigger value="approvals">Approval History</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {request.type === 'plant' ? 'Plant Code Details' : 'Company Code Details'}
                </CardTitle>
                <CardDescription>
                  Version {details ? (details as any).version : '—'} • Last updated: {new Date(request.updatedAt).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {details ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {request.type === 'plant' ? (
                      <>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Company Code</label>
                          <p className="text-sm">{(details as PlantCodeDetails).companyCode}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Plant Code</label>
                          <p className="text-sm">{(details as PlantCodeDetails).plantCode}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Name of Plant</label>
                          <p className="text-sm">{(details as PlantCodeDetails).nameOfPlant}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">GST Certificate</label>
                          <p className="text-sm">{(details as PlantCodeDetails).gstCertificate}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Purchase Organization</label>
                          <p className="text-sm">{(details as PlantCodeDetails).purchaseOrganization}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Sales Organization</label>
                          <p className="text-sm">{(details as PlantCodeDetails).salesOrganization}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Profit Center</label>
                          <p className="text-sm">{(details as PlantCodeDetails).profitCenter}</p>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-sm font-medium text-muted-foreground">Address of Plant</label>
                          <p className="text-sm">{(details as PlantCodeDetails).addressOfPlant}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Company Code</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).companyCode}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Company Name</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).nameOfCompanyCode}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Shareholding %</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).shareholdingPercentage}%</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Segment</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).segment}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">GST Certificate</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).gstCertificate}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">CIN</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).cin}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">PAN</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).pan}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-muted-foreground">Name of Segment</label>
                          <p className="text-sm">{(details as CompanyCodeDetails).nameOfSegment}</p>
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
                    {approvals.map((approval, index) => (
                      <div key={`${approval.requestId}-${approval.approverEmail}`} className="flex items-start space-x-3">
                        <div className="flex-shrink-0">
                          {approval.decision === 'approve' ? (
                            <CheckCircle className="h-5 w-5 text-success" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">{approval.approverEmail}</span>
                              <Badge variant={approval.decision === 'approve' ? 'success' : 'destructive'}>
                                {approval.decision === 'approve' ? 'Approved' : 'Rejected'}
                              </Badge>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {new Date(approval.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {approval.comment && (
                            <p className="text-sm text-muted-foreground">{approval.comment}</p>
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
                    {history.map((log, index) => {
                      const Icon = getActionIcon(log.action);
                      return (
                        <div key={`${log.requestId}-${log.timestamp}`} className="flex items-start space-x-3">
                          <div className="flex-shrink-0">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium capitalize">{log.action.replace('-', ' ')}</span>
                              <span className="text-sm text-muted-foreground">
                                {new Date(log.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{log.user}</span>
                            </div>
                            {log.metadata && (
                              <p className="text-sm text-muted-foreground">
                                {JSON.stringify(log.metadata, null, 2)}
                              </p>
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
        </Tabs>
      </DialogContent>
      
      <DocumentViewer
        open={documentViewer.open}
        onOpenChange={(open) => setDocumentViewer(prev => ({ ...prev, open }))}
        fileName={documentViewer.fileName}
        fileContent={documentViewer.fileContent}
        fileType={documentViewer.fileType}
      />
    </Dialog>
  );
}