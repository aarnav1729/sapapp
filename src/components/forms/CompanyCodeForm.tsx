import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Building, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Request,
  CompanyCodeDetails,
  saveRequest,
  saveCompanyCodeDetails,
  saveHistoryLog,
  getLatestRequestDetails,
  uploadAttachment,
} from "@/lib/storage";
import {
  compareObjects,
  formatChangesForNotification,
  generateChangesSummary,
} from "@/lib/changeTracking";

interface CompanyCodeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  existingRequest?: Request;
  isChangeRequest?: boolean;
  onSuccess: () => void;
}

export function CompanyCodeForm({
  open,
  onOpenChange,
  userEmail,
  existingRequest,
  isChangeRequest = false,
  onSuccess,
}: CompanyCodeFormProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [originalData, setOriginalData] = useState<CompanyCodeDetails | null>(
    null
  );
  const [latestVersion, setLatestVersion] = useState<number | null>(null);
  const { toast } = useToast();
  const [attachmentsDraft, setAttachmentsDraft] = useState<
    Record<string, { fileName: string; fileType: string; dataUrl: string }>
  >({});
  const ATTACH_TITLES: Record<string, string> = {
    gstCertificate: "GST Certificate",
    cin: "CIN",
    pan: "PAN",
  };

  // memo key for effect dependencies
  const reqIdKey = useMemo(() => {
    const anyReq: any = existingRequest || {};
    return anyReq.requestId || anyReq.id || "";
  }, [existingRequest]);

  const dialogTitleText = isChangeRequest
    ? "Create Change Request - Company Code"
    : existingRequest
    ? "Edit Company Code Request"
    : "Create Company Code Request";

  const dialogDescriptionText = isChangeRequest
    ? "Create a change request for this existing company code. Changes will go through the full approval process."
    : existingRequest
    ? "Update your company code creation request details"
    : "Fill in all required information for company code creation";

  // Form data
  const [formData, setFormData] = useState({
    companyCode: "",
    nameOfCompanyCode: "",
    shareholdingPercentage: "",
    // ⬇️ new numbers
    gstNumber: "",
    cinNumber: "",
    panNumber: "",
    // existing attachments/fields
    gstCertificate: "",
    cin: "",
    pan: "",
    segment: "",
    nameOfSegment: "",
  });

  // Robust prefill: inline details -> fetch latest; prevent races
  useEffect(() => {
    let active = true;

    async function prefill() {
      if (!open) return;

      // Brand-new create
      if (!existingRequest && !isChangeRequest) {
        resetForm();
        return;
      }

      if (!existingRequest) return;

      const anyReq: any = existingRequest;
      const inlineDetails: Partial<CompanyCodeDetails> | null =
        anyReq.details || null;
      const currentReqId: string = anyReq.requestId || anyReq.id;

      // 1) Inline details if present
      if (inlineDetails) {
        setFormData({
          companyCode: inlineDetails.companyCode || "",
          nameOfCompanyCode: inlineDetails.nameOfCompanyCode || "",
          shareholdingPercentage: (
            inlineDetails.shareholdingPercentage ?? ""
          ).toString(),
          // ⬇️ new numbers (fallback blank for older rows)
          gstNumber: (inlineDetails as any).gstNumber || "",
          cinNumber: (inlineDetails as any).cinNumber || "",
          panNumber: (inlineDetails as any).panNumber || "",
          // existing attachment/file-name placeholders (kept)
          gstCertificate: inlineDetails.gstCertificate || "",
          cin: inlineDetails.cin || "",
          pan: inlineDetails.pan || "",
          segment: inlineDetails.segment || "",
          nameOfSegment: inlineDetails.nameOfSegment || "",
        });

        setOriginalData(inlineDetails as CompanyCodeDetails);
        setLatestVersion(
          typeof (inlineDetails as any)?.version === "number"
            ? Number((inlineDetails as any).version)
            : 0
        );
      }

      // 2) Fetch latest from API
      if (currentReqId) {
        try {
          const fetched = (await getLatestRequestDetails(
            currentReqId,
            "company"
          )) as CompanyCodeDetails | null;
          if (!active || !fetched) return;

          setFormData({
            companyCode: fetched.companyCode || "",
            nameOfCompanyCode: fetched.nameOfCompanyCode || "",
            shareholdingPercentage: (
              fetched.shareholdingPercentage ?? ""
            ).toString(),
            // ⬇️ new numbers (fallback blank for older rows)
            gstNumber: (fetched as any).gstNumber || "",
            cinNumber: (fetched as any).cinNumber || "",
            panNumber: (fetched as any).panNumber || "",
            // existing attachment/file-name placeholders (kept)
            gstCertificate: fetched.gstCertificate || "",
            cin: fetched.cin || "",
            pan: fetched.pan || "",
            segment: fetched.segment || "",
            nameOfSegment: fetched.nameOfSegment || "",
          });

          setOriginalData(fetched);
          setLatestVersion(
            typeof (fetched as any).version === "number"
              ? (fetched as any).version
              : 0
          );
        } catch (e) {
          // Keep inline details if set; otherwise remain as-is
          // eslint-disable-next-line no-console
          console.error("Error loading existing company details:", e);
        }
      }
    }

    prefill();
    return () => {
      active = false;
    };
  }, [open, reqIdKey, isChangeRequest]);

  const resetForm = () => {
    setFormData({
      companyCode: "",
      nameOfCompanyCode: "",
      shareholdingPercentage: "",
      gstNumber: "",
      cinNumber: "",
      panNumber: "",
      gstCertificate: "",
      cin: "",
      pan: "",
      segment: "",
      nameOfSegment: "",
    });

    setOriginalData(null);
    setLatestVersion(null);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileUpload = (field: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          handleInputChange(field, file.name);
          setAttachmentsDraft((prev) => ({
            ...prev,
            [field]: {
              fileName: file.name,
              fileType: file.type,
              dataUrl: String(reader.result),
            },
          }));
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const validateForm = () => {
    const requiredFields = Object.keys(formData);
    const emptyFields = requiredFields.filter(
      (field) =>
        !String((formData as any)[field] ?? "")
          .toString()
          .trim()
    );

    if (emptyFields.length > 0) {
      toast({
        title: "Validation Error",
        description:
          "All fields are mandatory. Please fill in all required information.",
        variant: "destructive",
      });
      return false;
    }

    // Check shareholding percentage
    const percentage = parseFloat(formData.shareholdingPercentage);
    if (isNaN(percentage) || percentage < 51) {
      toast({
        title: "Validation Error",
        description: "PEL must hold at least 51% shareholding percentage.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    if ((existingRequest || isChangeRequest) && !showConfirmation) {
      setShowConfirmation(true);
      return;
    }

    setLoading(true);

    try {
      const now = new Date().toISOString();

      const anyReq: any = existingRequest || {};
      const baseId = anyReq.requestId || anyReq.id;

      // Determine next version
      const nextVersion = isChangeRequest ? 1 : (latestVersion ?? 0) + 1;

      // Create/Update request first to get the server-generated ID
      let requestId: string;
      const title = isChangeRequest
        ? `Change Request - Company Code: ${formData.companyCode} - ${formData.nameOfCompanyCode}`
        : `Company Code: ${formData.companyCode} - ${formData.nameOfCompanyCode}`;

      if (existingRequest && !isChangeRequest) {
        requestId = String(baseId);
        await saveRequest({
          requestId,
          type: "company",
          title,
          status: "pending-secretary",
          createdBy: userEmail,
          createdAt: anyReq.createdAt || now,
          updatedAt: now,
        } as any);
      } else {
        const created: any = await saveRequest({
          // omit requestId to force server-side id generation
          type: "company",
          title,
          status: "pending-secretary",
          createdBy: userEmail,
          ncType: isChangeRequest ? "C" : "N",
          createdAt: now,
          updatedAt: now,
        } as any);
        requestId =
          created?.requestId ??
          created?.data?.requestId ??
          created?.data?.data?.requestId;
      }

      if (!requestId) throw new Error("Missing server-generated requestId");

      const details: CompanyCodeDetails = {
        requestId,
        companyCode: formData.companyCode,
        nameOfCompanyCode: formData.nameOfCompanyCode,
        shareholdingPercentage: parseFloat(formData.shareholdingPercentage),
        // ⬇️ new numbers
        gstNumber: formData.gstNumber,
        cinNumber: formData.cinNumber,
        panNumber: formData.panNumber,
        // existing
        gstCertificate: formData.gstCertificate,
        cin: formData.cin,
        pan: formData.pan,
        segment: formData.segment,
        nameOfSegment: formData.nameOfSegment,
        version: nextVersion,
      };

      try {
        const staged = Object.entries(attachmentsDraft);
        if (staged.length) {
          await Promise.all(
            staged.map(([field, f]) =>
              uploadAttachment({
                requestId,
                fileName: f.fileName,
                fileType: f.fileType,
                fileContent: f.dataUrl,
                version: nextVersion,
                title: ATTACH_TITLES[field] || field,
                uploadedBy: userEmail,
              })
            )
          );
          setAttachmentsDraft({});
        }
      } catch (e) {
        console.error("Attachment upload failed:", e);
      }

      await saveCompanyCodeDetails(details);

      // Non-critical history
      try {
        if (isChangeRequest && originalData) {
          const comparison = compareObjects(originalData, formData, "company");
          const changesSummary = formatChangesForNotification(
            comparison.changes
          );
          await saveHistoryLog({
            requestId,
            action: "create",
            user: userEmail,
            timestamp: now,
            metadata: {
              type: "company",
              title: title,
              isChangeRequest: true,
              originalRequestId: baseId || null,
              changes: comparison.changes,
              changesSummary,
            },
          });
        } else {
          if (originalData) {
            const comparison = compareObjects(
              originalData,
              formData,
              "company"
            );
            const changesSummary = formatChangesForNotification(
              comparison.changes
            );
            await saveHistoryLog({
              requestId,
              action: existingRequest ? "edit" : "create",
              user: userEmail,
              timestamp: now,
              metadata: {
                type: "company",
                title: title,
                changes: comparison.changes,
                changesSummary,
              },
            });
          } else {
            await saveHistoryLog({
              requestId,
              action: existingRequest ? "edit" : "create",
              user: userEmail,
              timestamp: now,
              metadata: { type: "company", title},
            });
          }
        }
      } catch (historyError) {
        // eslint-disable-next-line no-console
        console.error(
          "Non-critical: failed to write history log",
          historyError
        );
      }

      toast({
        title: isChangeRequest
          ? "Change Request Created"
          : existingRequest
          ? "Request Updated"
          : "Request Created",
        description: isChangeRequest
          ? "Change request created successfully."
          : existingRequest
          ? "Your company code request has been updated successfully"
          : "Your company code request has been created and submitted for approval",
        variant: "default",
      });

      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setShowConfirmation(false);
    }
  };

  const renderDetectedChanges = () => {
    if (!originalData) return null;
    const comparison = compareObjects(originalData, formData, "company");
    if (!comparison.hasChanges) return null;
    return (
      <div className="mt-2">
        <p className="font-medium">Changes detected:</p>
        <div className="text-sm bg-muted p-2 rounded mt-1 whitespace-pre-line">
          {generateChangesSummary(comparison.changes)}
        </div>
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setShowConfirmation(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="w-[90vw] max-w-[90vw] max-h-[90vh] overflow-y-auto">
        {/* Always provide a DialogTitle for a11y; keep it visually hidden */}
        <VisuallyHidden>
          <DialogTitle>{dialogTitleText}</DialogTitle>
        </VisuallyHidden>

        <DialogHeader>
          {/* Visible heading that mirrors the hidden DialogTitle */}
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {dialogTitleText}
          </h2>
          <DialogDescription>{dialogDescriptionText}</DialogDescription>
        </DialogHeader>

        {showConfirmation && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {isChangeRequest
                ? "Are you sure you want to create this change request? It will go through the full approval process."
                : "Are you sure you want to confirm these changes? This will create a new version of your request."}
              {renderDetectedChanges()}
            </AlertDescription>
            <div className="flex space-x-2 mt-3">
              <Button size="sm" onClick={handleSubmit} disabled={loading}>
                {isChangeRequest
                  ? "Create Change Request"
                  : "Yes, Confirm Changes"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowConfirmation(false)}
              >
                Cancel
              </Button>
            </div>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Building className="h-5 w-5 text-primary" />
              <span>Company Code Details</span>
            </CardTitle>
            <CardDescription>
              Expected completion time: 10 days after data received. All fields
              are mandatory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyCode">Company Code *</Label>
                <Input
                  id="companyCode"
                  inputMode="numeric"
                  pattern="\d*"
                  value={formData.companyCode}
                  onChange={(e) =>
                    handleInputChange(
                      "companyCode",
                      e.target.value.replace(/\D/g, "")
                    )
                  }
                  placeholder="Enter company code"
                  disabled={isChangeRequest}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOfCompanyCode">
                  Name of Company Code *
                </Label>
                <Input
                  id="nameOfCompanyCode"
                  value={formData.nameOfCompanyCode}
                  onChange={(e) =>
                    handleInputChange("nameOfCompanyCode", e.target.value)
                  }
                  placeholder="Enter company code name"
                />
              </div>

              <div className="space-y-2 col-span-full">
                <Label htmlFor="shareholdingPercentage">
                  Shareholding Percentage (%) *
                </Label>
                <Input
                  id="shareholdingPercentage"
                  type="number"
                  min="51"
                  max="100"
                  value={formData.shareholdingPercentage}
                  onChange={(e) =>
                    handleInputChange("shareholdingPercentage", e.target.value)
                  }
                  placeholder="Min 51% required"
                />
                <p className="text-sm text-muted-foreground">
                  PEL must hold at least 51%
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="segment">Segment Code *</Label>
                <Input
                  id="segment"
                  value={formData.segment}
                  onChange={(e) => handleInputChange("segment", e.target.value)}
                  placeholder="Enter segment"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOfSegment">Name of Segment *</Label>
                <Input
                  id="nameOfSegment"
                  value={formData.nameOfSegment}
                  onChange={(e) =>
                    handleInputChange("nameOfSegment", e.target.value)
                  }
                  placeholder="Enter segment name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gstNumber">GST Number *</Label>
                <Input
                  id="gstNumber"
                  value={formData.gstNumber}
                  onChange={(e) =>
                    handleInputChange("gstNumber", e.target.value.trim())
                  }
                  placeholder="Enter GSTIN (e.g., 22AAAAA0000A1Z5)"
                />
              </div>

              <div className="space-y-2">
                <Label>GST Certificate *</Label>
                <Button
                  variant="outline"
                  onClick={() => handleFileUpload("gstCertificate")}
                  className="w-full justify-start"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {formData.gstCertificate || "Upload GST Certificate"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cinNumber">CIN Number *</Label>
                <Input
                  id="cinNumber"
                  value={formData.cinNumber}
                  onChange={(e) =>
                    handleInputChange("cinNumber", e.target.value.trim())
                  }
                  placeholder="Enter 21-character CIN"
                />
              </div>

              <div className="space-y-2">
                <Label>CIN *</Label>
                <Button
                  variant="outline"
                  onClick={() => handleFileUpload("cin")}
                  className="w-full justify-start"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {formData.cin || "Upload CIN"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="panNumber">PAN Number *</Label>
                <Input
                  id="panNumber"
                  value={formData.panNumber}
                  onChange={(e) =>
                    handleInputChange("panNumber", e.target.value.trim())
                  }
                  placeholder="Enter 10-character PAN"
                />
              </div>

              <div className="space-y-2">
                <Label>PAN *</Label>
                <Button
                  variant="outline"
                  onClick={() => handleFileUpload("pan")}
                  className="w-full justify-start"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {formData.pan || "Upload PAN"}
                </Button>
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-medium text-sm">Important Notes:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • A new company code can only be created if PEL Group holds ≥
                  51% Stake in the company
                </li>
                <li>
                  • The company code creation will take 10 days from the receipt
                  of an approved request
                </li>
                <li>• All fields are mandatory</li>
              </ul>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading
                  ? existingRequest
                    ? "Updating..."
                    : "Creating..."
                  : existingRequest
                  ? "Update Request"
                  : "Create Request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
