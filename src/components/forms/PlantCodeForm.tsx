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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, AlertTriangle, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Request,
  PlantCodeDetails,
  saveRequest,
  savePlantCodeDetails,
  saveHistoryLog,
  getLatestRequestDetails,
  uploadAttachment,
  getMasterCompanyCodes,
} from "@/lib/storage";
import {
  compareObjects,
  formatChangesForNotification,
  generateChangesSummary,
} from "@/lib/changeTracking";

interface PlantCodeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  existingRequest?: Request;
  isChangeRequest?: boolean;
  onSuccess: () => void;
}

export function PlantCodeForm({
  open,
  onOpenChange,
  userEmail,
  existingRequest,
  isChangeRequest = false,
  onSuccess,
}: PlantCodeFormProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [originalData, setOriginalData] = useState<PlantCodeDetails | null>(
    null
  );
  const [latestVersion, setLatestVersion] = useState<number | null>(null);
  const { toast } = useToast();
  const [attachmentsDraft, setAttachmentsDraft] = useState<
    Record<string, { fileName: string; fileType: string; dataUrl: string }>
  >({});
  const ATTACH_TITLES: Record<string, string> = {
    gstCertificate: "GST Certificate",
  };
  const [companyCodes, setCompanyCodes] = useState<string[]>([]);

  // memo key for effect dependencies (stable across prop shuffles)
  const reqIdKey = useMemo(() => {
    const anyReq: any = existingRequest || {};
    return anyReq.requestId || anyReq.id || "";
  }, [existingRequest]);

  // Load master company codes for NEW requests only
  useEffect(() => {
    if (!open) return;
    if (existingRequest || isChangeRequest) return; // only for creation
    let active = true;
    (async () => {
      try {
        const rows = await getMasterCompanyCodes({ limit: 10000, offset: 0 });
        if (!active) return;
        const codes = Array.from(
          new Set((rows || []).map((r: any) => String(r.companyCode || "")))
        ).filter(Boolean);
        setCompanyCodes(codes);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to load master company codes", e);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, existingRequest, isChangeRequest]);

  // Compute text once so hidden title and visible heading stay in sync
  const dialogTitleText = isChangeRequest
    ? "Create Change Request - Plant Code"
    : existingRequest
    ? "Edit Plant Code Request"
    : "Create Plant Code Request";

  const dialogDescriptionText = isChangeRequest
    ? "Create a change request for this existing plant code. Changes will go through the full approval process."
    : existingRequest
    ? "Update your plant code creation request details"
    : "Fill in all required information for plant code creation";

  // Form data
  const [formData, setFormData] = useState({
    companyCode: "",
    gstNumber: "", // ⬅️ NEW
    gstCertificate: "",
    plantCode: "",
    nameOfPlant: "",
    addressOfPlant: "",
    purchaseOrganization: "",
    nameOfPurchaseOrganization: "",
    salesOrganization: "",
    nameOfSalesOrganization: "",
    profitCenter: "",
    nameOfProfitCenter: "",
    costCenters: "",
    nameOfCostCenters: "",
    projectCode: "",
    projectCodeDescription: "",
    storageLocationCode: "",
    storageLocationDescription: "",
  });

  // Robust prefill: prefer inline details, else fetch; avoid races
  useEffect(() => {
    let active = true;

    async function prefill() {
      if (!open) return;

      // Brand-new create (no request to edit/change)
      if (!existingRequest && !isChangeRequest) {
        resetForm();
        return;
      }

      // If we somehow don't have a request (shouldn't happen when editing/CR), bail
      if (!existingRequest) return;

      const anyReq: any = existingRequest;
      const inlineDetails: Partial<PlantCodeDetails> | null =
        anyReq.details || null;
      const currentReqId: string = anyReq.requestId || anyReq.id;

      // 1) Prefer inline details (instant)
      if (inlineDetails) {
        const formDataObj = {
          companyCode: inlineDetails.companyCode || "",
          gstNumber: (inlineDetails as any).gstNumber || "",
          gstCertificate: inlineDetails.gstCertificate || "",
          plantCode: inlineDetails.plantCode || "",
          nameOfPlant: inlineDetails.nameOfPlant || "",
          addressOfPlant: inlineDetails.addressOfPlant || "",
          purchaseOrganization: inlineDetails.purchaseOrganization || "",
          nameOfPurchaseOrganization:
            inlineDetails.nameOfPurchaseOrganization || "",
          salesOrganization: inlineDetails.salesOrganization || "",
          nameOfSalesOrganization: inlineDetails.nameOfSalesOrganization || "",
          profitCenter: inlineDetails.profitCenter || "",
          nameOfProfitCenter: inlineDetails.nameOfProfitCenter || "",
          costCenters: inlineDetails.costCenters || "",
          nameOfCostCenters: inlineDetails.nameOfCostCenters || "",
          projectCode: inlineDetails.projectCode || "",
          projectCodeDescription: inlineDetails.projectCodeDescription || "",
          storageLocationCode: inlineDetails.storageLocationCode || "",
          storageLocationDescription:
            inlineDetails.storageLocationDescription || "",
        };
        if (!active) return;
        setFormData(formDataObj);
        setOriginalData(inlineDetails as PlantCodeDetails);
        setLatestVersion(
          typeof (inlineDetails as any)?.version === "number"
            ? Number((inlineDetails as any).version)
            : 0
        );
        // still try to fetch latest in background to ensure we're at max version (won't clobber if same)
      }

      // 2) Fetch latest details as the source of truth
      if (currentReqId) {
        try {
          const fetched = (await getLatestRequestDetails(
            currentReqId,
            "plant"
          )) as PlantCodeDetails | null;
          if (!active || !fetched) return;

          const formDataObj = {
            companyCode: fetched.companyCode || "",
            gstNumber: (fetched as any).gstNumber || "",
            gstCertificate: fetched.gstCertificate || "",
            plantCode: fetched.plantCode || "",
            nameOfPlant: fetched.nameOfPlant || "",
            addressOfPlant: fetched.addressOfPlant || "",
            purchaseOrganization: fetched.purchaseOrganization || "",
            nameOfPurchaseOrganization:
              fetched.nameOfPurchaseOrganization || "",
            salesOrganization: fetched.salesOrganization || "",
            nameOfSalesOrganization: fetched.nameOfSalesOrganization || "",
            profitCenter: fetched.profitCenter || "",
            nameOfProfitCenter: fetched.nameOfProfitCenter || "",
            costCenters: fetched.costCenters || "",
            nameOfCostCenters: fetched.nameOfCostCenters || "",
            projectCode: fetched.projectCode || "",
            projectCodeDescription: fetched.projectCodeDescription || "",
            storageLocationCode: fetched.storageLocationCode || "",
            storageLocationDescription:
              fetched.storageLocationDescription || "",
          };

          setFormData(formDataObj);
          setOriginalData(fetched);
          setLatestVersion(
            typeof (fetched as any).version === "number"
              ? (fetched as any).version
              : 0
          );
        } catch (e) {
          // Keep inline details if we had them; otherwise remain as-is
          // eslint-disable-next-line no-console
          console.error("Error loading existing plant details:", e);
        }
      }
    }

    prefill();
    return () => {
      active = false;
    };
  }, [open, reqIdKey, isChangeRequest]); // stable deps

  const resetForm = () => {
    setFormData({
      companyCode: "",
      gstNumber: "",
      gstCertificate: "",
      plantCode: "",
      nameOfPlant: "",
      addressOfPlant: "",
      purchaseOrganization: "",
      nameOfPurchaseOrganization: "",
      salesOrganization: "",
      nameOfSalesOrganization: "",
      profitCenter: "",
      nameOfProfitCenter: "",
      costCenters: "",
      nameOfCostCenters: "",
      projectCode: "",
      projectCodeDescription: "",
      storageLocationCode: "",
      storageLocationDescription: "",
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
          // Show file name in the UI
          handleInputChange(field, file.name);
          // Stage the actual binary for upload on submit
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

  // ⬇️ NEW: tiny helpers for pairing & lists (newline-separated storage)
  const appendPair = (
    codeField: keyof typeof formData,
    nameField: keyof typeof formData,
    code: string,
    name: string
  ) => {
    const trimmedCode = (code || "").trim();
    const trimmedName = (name || "").trim();
    if (!trimmedCode || !trimmedName) return;

    setFormData((prev) => ({
      ...prev,
      [codeField]: prev[codeField]
        ? `${prev[codeField]}\n${trimmedCode}`
        : trimmedCode,
      [nameField]: prev[nameField]
        ? `${prev[nameField]}\n${trimmedName}`
        : trimmedName,
    }));
  };

  const listPairs = (codes: string, names: string) => {
    const a = (codes || "").split(/\n+/).filter(Boolean);
    const b = (names || "").split(/\n+/).filter(Boolean);
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, i) => [a[i] || "", b[i] || ""]);
  };

  // Temp inputs for the next pair entries
  const [ccNext, setCcNext] = useState({ code: "", name: "" });
  const [projNext, setProjNext] = useState({ code: "", desc: "" });
  const [slNext, setSlNext] = useState({ code: "", desc: "" });

  const removePair = (
    codeField: keyof typeof formData,
    nameField: keyof typeof formData,
    index: number
  ) => {
    setFormData((prev) => {
      const codes = String(prev[codeField] || "")
        .split(/\n+/)
        .filter(Boolean);
      const names = String(prev[nameField] || "")
        .split(/\n+/)
        .filter(Boolean);
      if (index < 0 || index >= Math.max(codes.length, names.length))
        return prev;
      codes.splice(index, 1);
      names.splice(index, 1);
      return {
        ...prev,
        [codeField]: codes.join("\n"),
        [nameField]: names.join("\n"),
      };
    });
  };

  const validateForm = () => {
    const requiredFields = Object.keys(formData);
    const emptyFields = requiredFields.filter(
      (field) => !String(formData[field as keyof typeof formData] ?? "").trim()
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

      // Resolve request id (always from server)
      const anyReq: any = existingRequest || {};
      const baseId = anyReq.requestId || anyReq.id;

      // Determine next version
      const nextVersion = isChangeRequest ? 1 : (latestVersion ?? 0) + 1;

      // Create/Update request first to get the server-generated ID
      let requestId: string;
      const title = isChangeRequest
        ? `Change Request - Plant Code: ${formData.plantCode} - ${formData.nameOfPlant}`
        : `Plant Code: ${formData.plantCode} - ${formData.nameOfPlant}`;

      if (existingRequest && !isChangeRequest) {
        // Editing an existing request → keep its id, update metadata
        requestId = String(baseId);
        await saveRequest({
          requestId,
          type: "plant",
          title,
          status: "pending-siva",
          createdBy: userEmail,
          createdAt: anyReq.createdAt || now,
          updatedAt: now,
        } as any);
      } else {
        // New or change request → let server generate the id
        const created: any = await saveRequest({
          // omit requestId to force server-side id generation
          type: "plant",
          title,
          status: "pending-siva",
          createdBy: userEmail,
          ncType: isChangeRequest ? "C" : "N",
          createdAt: now,
          updatedAt: now,
        } as any);
        // tolerate different return shapes (implementation-dependent)
        requestId =
          created?.requestId ??
          created?.data?.requestId ??
          created?.data?.data?.requestId;
      }

      if (!requestId) throw new Error("Missing server-generated requestId");

      const details: PlantCodeDetails = {
        requestId,
        ...formData,
        version: nextVersion,
      };

      // Upload any staged attachments for this version
      try {
        const staged = Object.entries(attachmentsDraft);
        if (staged.length) {
          await Promise.all(
            staged.map(([field, f]) =>
              uploadAttachment({
                requestId,
                fileName: f.fileName,
                fileType: f.fileType,
                fileContent: f.dataUrl, // base64 / data URL
                version: nextVersion, // keep version aligned with details
                title: ATTACH_TITLES[field] || field,
                uploadedBy: userEmail,
              })
            )
          );
          setAttachmentsDraft({}); // clear after success
        }
      } catch (e) {
        // Non-fatal for the form; surface a toast if you want
        console.error("Attachment upload failed:", e);
      }
      await savePlantCodeDetails(details);

      // Track history (non-critical; do not fail overall if this throws)
      try {
        if (isChangeRequest && originalData) {
          const comparison = compareObjects(originalData, formData, "plant");
          const changesSummary = formatChangesForNotification(
            comparison.changes
          );
          await saveHistoryLog({
            requestId,
            action: "create",
            user: userEmail,
            timestamp: now,
            metadata: {
              type: "plant",
              title,
              isChangeRequest: true,
              originalRequestId: baseId || null,
              changes: comparison.changes,
              changesSummary,
            },
          });
        } else {
          // edit or create
          if (originalData) {
            const comparison = compareObjects(originalData, formData, "plant");
            const changesSummary = formatChangesForNotification(
              comparison.changes
            );
            await saveHistoryLog({
              requestId,
              action: existingRequest ? "edit" : "create",
              user: userEmail,
              timestamp: now,
              metadata: {
                type: "plant",
                title,
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
              metadata: { type: "plant", title},
            });
          }
        }
      } catch (historyError) {
        // Non-blocking: log but don't convert success into failure
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
          ? "Your plant code request has been updated successfully"
          : "Your plant code request has been created and submitted for approval",
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
    const comparison = compareObjects(originalData, formData, "plant");
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
              <FileText className="h-5 w-5 text-primary" />
              <span>Plant Code Details</span>
            </CardTitle>
            <CardDescription>
              Expected completion time: 2 days after data received. All fields
              are mandatory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyCode">Company Code *</Label>
                {/* For NEW requests, render a dropdown of MasterCompanyCodes; otherwise keep (read-only) input */}
                {!existingRequest && !isChangeRequest ? (
                  <Select
                    value={formData.companyCode}
                    onValueChange={(v) => handleInputChange("companyCode", v)}
                  >
                    <SelectTrigger id="companyCode" aria-label="Company Code">
                      <SelectValue placeholder="Select company code" />
                    </SelectTrigger>
                    <SelectContent>
                      {companyCodes.map((cc) => (
                        <SelectItem key={cc} value={cc} className="font-mono">
                          {cc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="companyCode"
                    value={formData.companyCode}
                    onChange={(e) =>
                      handleInputChange("companyCode", e.target.value)
                    }
                    placeholder="Company code"
                    disabled={isChangeRequest}
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="plantCode">Plant Code *</Label>
                <Input
                  id="plantCode"
                  inputMode="numeric"
                  pattern="\d*"
                  value={formData.plantCode}
                  onChange={(e) =>
                    handleInputChange(
                      "plantCode",
                      e.target.value.replace(/\D/g, "")
                    )
                  }
                  placeholder="Enter plant code"
                  disabled={isChangeRequest}
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

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nameOfPlant">Name of the Plant *</Label>
                <Input
                  id="nameOfPlant"
                  value={formData.nameOfPlant}
                  onChange={(e) =>
                    handleInputChange("nameOfPlant", e.target.value)
                  }
                  placeholder="Enter plant name"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="addressOfPlant">
                  Address of the Plant (as per GST) *
                </Label>
                <Textarea
                  id="addressOfPlant"
                  value={formData.addressOfPlant}
                  onChange={(e) =>
                    handleInputChange("addressOfPlant", e.target.value)
                  }
                  placeholder="Enter plant address as per GST certificate"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="purchaseOrganization">
                  Purchase Organization *
                </Label>
                <Input
                  id="purchaseOrganization"
                  value={formData.purchaseOrganization}
                  onChange={(e) =>
                    handleInputChange("purchaseOrganization", e.target.value)
                  }
                  placeholder="Enter purchase organization"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOfPurchaseOrganization">
                  Name of Purchase Organization *
                </Label>
                <Input
                  id="nameOfPurchaseOrganization"
                  value={formData.nameOfPurchaseOrganization}
                  onChange={(e) =>
                    handleInputChange(
                      "nameOfPurchaseOrganization",
                      e.target.value
                    )
                  }
                  placeholder="Enter purchase organization name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="salesOrganization">Sales Organization *</Label>
                <Input
                  id="salesOrganization"
                  value={formData.salesOrganization}
                  onChange={(e) =>
                    handleInputChange("salesOrganization", e.target.value)
                  }
                  placeholder="Enter sales organization"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOfSalesOrganization">
                  Name of Sales Organization *
                </Label>
                <Input
                  id="nameOfSalesOrganization"
                  value={formData.nameOfSalesOrganization}
                  onChange={(e) =>
                    handleInputChange("nameOfSalesOrganization", e.target.value)
                  }
                  placeholder="Enter sales organization name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profitCenter">Profit Center *</Label>
                <Input
                  id="profitCenter"
                  value={formData.profitCenter}
                  onChange={(e) =>
                    handleInputChange("profitCenter", e.target.value)
                  }
                  placeholder="Enter profit center"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOfProfitCenter">
                  Name of Profit Center *
                </Label>
                <Input
                  id="nameOfProfitCenter"
                  value={formData.nameOfProfitCenter}
                  onChange={(e) =>
                    handleInputChange("nameOfProfitCenter", e.target.value)
                  }
                  placeholder="Enter profit center name"
                />
              </div>

              {/* ⬇️ NEW: Cost Centers pair with + add */}
              <div className="space-y-2 md:col-span-2">
                <Label>Cost Centers *</Label>
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-2"
                    placeholder="Cost Center"
                    value={ccNext.code}
                    onChange={(e) =>
                      setCcNext((p) => ({ ...p, code: e.target.value }))
                    }
                  />
                  <Input
                    className="col-span-3"
                    placeholder="Name of Cost Center"
                    value={ccNext.name}
                    onChange={(e) =>
                      setCcNext((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="col-span-1"
                    onClick={() => {
                      appendPair(
                        "costCenters",
                        "nameOfCostCenters",
                        ccNext.code,
                        ccNext.name
                      );
                      setCcNext({ code: "", name: "" });
                    }}
                    title="Add Cost Center"
                    aria-label="Add Cost Center"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {/* Show accumulated list */}
                {listPairs(formData.costCenters, formData.nameOfCostCenters)
                  .length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Added:
                    <ul className="list-disc ml-5 mt-1 space-y-0.5">
                      {listPairs(
                        formData.costCenters,
                        formData.nameOfCostCenters
                      ).map(([c, n], idx) => (
                        <li
                          key={idx}
                          className="font-mono flex items-center justify-between"
                        >
                          <span>
                            {c} — {n}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              removePair(
                                "costCenters",
                                "nameOfCostCenters",
                                idx
                              )
                            }
                            aria-label={`Remove cost center ${c}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ⬇️ NEW: Project Codes pair with + add */}
              <div className="space-y-2 md:col-span-2">
                <Label>Project Code (WBS) *</Label>
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-2"
                    placeholder="Project Code (WBS)"
                    value={projNext.code}
                    onChange={(e) =>
                      setProjNext((p) => ({ ...p, code: e.target.value }))
                    }
                  />
                  <Input
                    className="col-span-3"
                    placeholder="Project Code Description"
                    value={projNext.desc}
                    onChange={(e) =>
                      setProjNext((p) => ({ ...p, desc: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="col-span-1"
                    onClick={() => {
                      appendPair(
                        "projectCode",
                        "projectCodeDescription",
                        projNext.code,
                        projNext.desc
                      );
                      setProjNext({ code: "", desc: "" });
                    }}
                    title="Add Project Code"
                    aria-label="Add Project Code"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {listPairs(
                  formData.projectCode,
                  formData.projectCodeDescription
                ).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Added:
                    <ul className="list-disc ml-5 mt-1 space-y-0.5">
                      {listPairs(
                        formData.projectCode,
                        formData.projectCodeDescription
                      ).map(([c, d], idx) => (
                        <li
                          key={idx}
                          className="font-mono flex items-center justify-between"
                        >
                          <span>
                            {c} — {d}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              removePair(
                                "projectCode",
                                "projectCodeDescription",
                                idx
                              )
                            }
                            aria-label={`Remove project code ${c}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ⬇️ NEW: Storage Locations pair with + add */}
              <div className="space-y-2 md:col-span-2">
                <Label>Storage Location *</Label>
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-2"
                    placeholder="Storage Location Code"
                    value={slNext.code}
                    onChange={(e) =>
                      setSlNext((p) => ({ ...p, code: e.target.value }))
                    }
                  />
                  <Input
                    className="col-span-3"
                    placeholder="Storage Location Description"
                    value={slNext.desc}
                    onChange={(e) =>
                      setSlNext((p) => ({ ...p, desc: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="col-span-1"
                    onClick={() => {
                      appendPair(
                        "storageLocationCode",
                        "storageLocationDescription",
                        slNext.code,
                        slNext.desc
                      );
                      setSlNext({ code: "", desc: "" });
                    }}
                    title="Add Storage Location"
                    aria-label="Add Storage Location"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {listPairs(
                  formData.storageLocationCode,
                  formData.storageLocationDescription
                ).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Added:
                    <ul className="list-disc ml-5 mt-1 space-y-0.5">
                      {listPairs(
                        formData.storageLocationCode,
                        formData.storageLocationDescription
                      ).map(([c, d], idx) => (
                        <li
                          key={idx}
                          className="font-mono flex items-center justify-between"
                        >
                          <span>
                            {c} — {d}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              removePair(
                                "storageLocationCode",
                                "storageLocationDescription",
                                idx
                              )
                            }
                            aria-label={`Remove storage location ${c}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-medium text-sm">Important Notes:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • The plant code creation will take 2 days from receipt of an
                  approved request
                </li>
                <li>• All fields are mandatory</li>
                <li>
                  • Address of the plant will be printed on the PO Print Form
                </li>
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
