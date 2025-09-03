import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus,
  Eye,
  Edit,
  FileText,
  Building2,
  Search,
  Factory,
  Building,
} from "lucide-react";
import {
  Request,
  getRequestsByUser,
  getRequestsWithDetails,
  // ⬇️ NEW: master lists
  getMasterPlantCodes,
  getMasterCompanyCodes,
} from "@/lib/storage";
import { PlantCodeForm } from "@/components/forms/PlantCodeForm";
import { CompanyCodeForm } from "@/components/forms/CompanyCodeForm";
import { RequestDetailsDialog } from "@/components/dialogs/RequestDetailsDialog";
import { useToast } from "@/hooks/use-toast";

interface RequestorDashboardProps {
  userEmail: string;
}

type Mode = "new" | "change";

export function RequestorDashboard({ userEmail }: RequestorDashboardProps) {
  const [requests, setRequests] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [showPlantForm, setShowPlantForm] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [editingRequest, setEditingRequest] = useState<any | null>(null);
  const [isChangeFlow, setIsChangeFlow] = useState(false); // ⬅️ NEW: drives isChangeRequest for forms
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"my" | "all">("my");
  const { toast } = useToast();

  // Collapsible state: keep both collapsed by default
  const [openSections, setOpenSections] = useState<string[]>([]);

  // Action state for each section
  const [plantMode, setPlantMode] = useState<Mode>("new");
  const [companyMode, setCompanyMode] = useState<Mode>("new");

  // Masters + search
  const [masterPlants, setMasterPlants] = useState<any[]>([]);
  const [masterCompanies, setMasterCompanies] = useState<any[]>([]);
  const [plantSearch, setPlantSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [selectedPlantMasterKey, setSelectedPlantMasterKey] =
    useState<string>("");
  const [selectedCompanyMasterKey, setSelectedCompanyMasterKey] =
    useState<string>("");

  useEffect(() => {
    loadRequests();
  }, [userEmail]);

  // Load masters on first expansion of a section
  useEffect(() => {
    (async () => {
      if (openSections.includes("plant") && masterPlants.length === 0) {
        try {
          const rows = await getMasterPlantCodes();
          setMasterPlants(rows || []);
        } catch (e) {
          // no-op; graceful degradation
        }
      }
      if (openSections.includes("company") && masterCompanies.length === 0) {
        try {
          const rows = await getMasterCompanyCodes();
          setMasterCompanies(rows || []);
        } catch (e) {
          // no-op
        }
      }
    })();
  }, [openSections, masterPlants.length, masterCompanies.length]);

  const loadRequests = async () => {
    try {
      const userRequests = await getRequestsByUser(userEmail);
      const allRequestsData = await getRequestsWithDetails();
      setRequests(userRequests);
      setAllRequests(allRequestsData);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load requests",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      draft: { label: "Draft", variant: "secondary" as const },
      "pending-secretary": {
        label: "Pending Secretarial",
        variant: "warning" as const,
      },
      "pending-siva": {
        label: "Pending Finance Approver 1",
        variant: "warning" as const,
      },
      "pending-raghu": {
        label: "Pending Finance Approver 2",
        variant: "warning" as const,
      },
      "pending-manoj": {
        label: "Pending Finance Approver 3",
        variant: "warning" as const,
      },

      approved: { label: "Approved", variant: "success" as const },
      rejected: { label: "Rejected", variant: "destructive" as const },
      "sap-updated": { label: "SAP Updated", variant: "success" as const },
      completed: { label: "Completed", variant: "success" as const },
    };

    const config = (statusConfig as any)[status] || {
      label: status,
      variant: "secondary" as const,
    };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const displayRequests = view === "my" ? requests : allRequests;
  const plantRequests = displayRequests.filter((r) => r.type === "plant");
  const companyRequests = displayRequests.filter((r) => r.type === "company");

  const canEdit = (request: any) => {
    if (view === "my") {
      // Allow editing even if rejected (resubmits to first approver on save)
      return (
        request.status !== "approved" &&
        request.status !== "sap-updated" &&
        request.status !== "completed"
      );
    }
    return (
      request.status === "approved" ||
      request.status === "sap-updated" ||
      request.status === "completed"
    );
  };

  const getEditLabel = (request: any) => {
    if (view === "my") {
      return request.status === "draft" ? "Edit" : "Edit Draft";
    }
    return "Change Request";
  };

  // --- Helpers to sanitize master rows into our form fields ---
  const normalizeKey = (k: string) => k.toLowerCase().replace(/[\s_-]+/g, "");

  const getVal = (row: any, candidates: string[], fallback = "") => {
    if (!row) return fallback;
    const normalizedLookup: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      normalizedLookup[normalizeKey(key)] = row[key];
    }
    for (const c of candidates) {
      const hit = normalizedLookup[normalizeKey(c)];
      if (hit !== undefined && hit !== null) return String(hit);
    }
    return fallback;
  };

  const buildPlantPrefillFromMaster = (row: any) => {
    return {
      companyCode: getVal(row, ["companyCode", "company_code", "company"]),
      gstCertificate: "", // not in master; user can upload
      plantCode: getVal(row, ["plantCode", "plant_code", "plant"]),
      nameOfPlant: getVal(row, ["nameOfPlant", "plantName", "name"]),
      addressOfPlant: getVal(row, ["addressOfPlant", "address"]),
      purchaseOrganization: getVal(row, ["purchaseOrganization", "po"]),
      nameOfPurchaseOrganization: getVal(row, [
        "nameOfPurchaseOrganization",
        "purchaseOrganizationName",
      ]),
      salesOrganization: getVal(row, ["salesOrganization", "so"]),
      nameOfSalesOrganization: getVal(row, [
        "nameOfSalesOrganization",
        "salesOrganizationName",
      ]),
      profitCenter: getVal(row, ["profitCenter", "pc"]),
      nameOfProfitCenter: getVal(row, [
        "nameOfProfitCenter",
        "profitCenterName",
      ]),
      costCenters: getVal(row, ["costCenters", "cc"]),
      nameOfCostCenters: getVal(row, ["nameOfCostCenters", "costCentersName"]),
      projectCode: getVal(row, ["projectCode"]),
      projectCodeDescription: getVal(row, ["projectCodeDescription"]),
      storageLocationCode: getVal(row, ["storageLocationCode"]),
      storageLocationDescription: getVal(row, ["storageLocationDescription"]),
    };
  };

  const buildCompanyPrefillFromMaster = (row: any) => {
    return {
      companyCode: getVal(row, ["companyCode", "company_code", "code"]),
      nameOfCompanyCode: getVal(row, [
        "nameOfCompanyCode",
        "companyName",
        "name",
      ]),
      shareholdingPercentage: getVal(row, [
        "shareholdingPercentage",
        "shareholding",
        "share",
      ]),
      gstCertificate: "",
      cin: getVal(row, ["cin"]),
      pan: getVal(row, ["pan"]),
      segment: getVal(row, ["segment"]),
      nameOfSegment: getVal(row, ["nameOfSegment", "segmentName"]),
    };
  };

  // Display string for master items
  const plantMasterDisplay = (row: any) => {
    const code = getVal(row, ["plantCode", "plant_code", "plant"]);
    const name = getVal(row, ["nameOfPlant", "plantName", "name"]);
    const company = getVal(row, ["companyCode", "company_code"]);
    return [code, name, company && `(Co: ${company})`]
      .filter(Boolean)
      .join(" - ");
  };

  const companyMasterDisplay = (row: any) => {
    const code = getVal(row, ["companyCode", "company_code", "code"]);
    const name = getVal(row, ["nameOfCompanyCode", "companyName", "name"]);
    const seg = getVal(row, ["segment"]);
    return [code, name, seg && `(Seg: ${seg})`].filter(Boolean).join(" - ");
  };

  // Filtered masters
  const filteredPlantMasters = useMemo(() => {
    const q = plantSearch.trim().toLowerCase();
    if (!q) return masterPlants;
    return masterPlants.filter((r) =>
      plantMasterDisplay(r).toLowerCase().includes(q)
    );
  }, [plantSearch, masterPlants]);

  const filteredCompanyMasters = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return masterCompanies;
    return masterCompanies.filter((r) =>
      companyMasterDisplay(r).toLowerCase().includes(q)
    );
  }, [companySearch, masterCompanies]);

  // Lookups by synthetic key (prefer a stable code, fallback to index)
  const plantKeyFor = (row: any, idx: number) =>
    getVal(row, ["plantCode", "plant_code", "plant"]) || `row-${idx}`;
  const companyKeyFor = (row: any, idx: number) =>
    getVal(row, ["companyCode", "company_code", "code"]) || `row-${idx}`;

  const startNewPlant = () => {
    setEditingRequest(null);
    setIsChangeFlow(false);
    setShowPlantForm(true);
  };

  const startNewCompany = () => {
    setEditingRequest(null);
    setIsChangeFlow(false);
    setShowCompanyForm(true);
  };

  const startChangeFromPlantMaster = () => {
    if (!selectedPlantMasterKey) return;
    const row =
      filteredPlantMasters.find(
        (r, i) => plantKeyFor(r, i) === selectedPlantMasterKey
      ) || null;
    if (!row) return;

    const details = buildPlantPrefillFromMaster(row);
    const now = new Date().toISOString();
    const fakeReq: any = {
      // minimal shape; forms read `.details` safely
      type: "plant",
      title: `Change Request - Plant Code: ${details.plantCode} - ${details.nameOfPlant}`,
      status: "approved", // irrelevant; not persisted by the change form
      createdBy: userEmail,
      createdAt: now,
      updatedAt: now,
      details,
    };

    setEditingRequest(fakeReq);
    setIsChangeFlow(true);
    setShowPlantForm(true);
  };

  const startChangeFromCompanyMaster = () => {
    if (!selectedCompanyMasterKey) return;
    const row =
      filteredCompanyMasters.find(
        (r, i) => companyKeyFor(r, i) === selectedCompanyMasterKey
      ) || null;
    if (!row) return;

    const details = buildCompanyPrefillFromMaster(row);
    const now = new Date().toISOString();
    const fakeReq: any = {
      type: "company",
      title: `Change Request - Company Code: ${details.companyCode} - ${details.nameOfCompanyCode}`,
      status: "approved",
      createdBy: userEmail,
      createdAt: now,
      updatedAt: now,
      details,
    };

    setEditingRequest(fakeReq);
    setIsChangeFlow(true);
    setShowCompanyForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading requests...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {view === "my" ? "My Requests" : "All Requests"}
          </h1>
          <p className="text-muted-foreground">
            {view === "my"
              ? "Create and track your Plant Code and Company Code requests"
              : "View all existing codes and create change requests"}
          </p>
        </div>
        <Select
          value={view}
          onValueChange={(value) => setView(value as "my" | "all")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="my">My Requests</SelectItem>
            <SelectItem value="all">All Codes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Collapsible sections */}
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={(v) => setOpenSections(v as string[])}
        className="space-y-4"
      >
        {/* Company Section */}
        <AccordionItem value="company" className="border rounded-lg">
          <AccordionTrigger className="px-4">
            <div className="flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold">
                {view === "my" ? "Company Code Requests" : "All Company Codes"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {/* Action row */}
            <Card className="bg-gradient-card shadow-soft mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Action</CardTitle>
                <CardDescription>
                  Choose request type and proceed
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Request Type</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={companyMode === "new" ? "default" : "outline"}
                      onClick={() => setCompanyMode("new")}
                    >
                      New
                    </Button>
                    <Button
                      size="sm"
                      variant={companyMode === "change" ? "default" : "outline"}
                      onClick={() => setCompanyMode("change")}
                    >
                      Change
                    </Button>
                  </div>
                </div>

                {companyMode === "new" ? (
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      onClick={startNewCompany}
                      disabled={view !== "my"}
                      title={
                        view !== "my" ? "Switch to 'My Requests' to create" : ""
                      }
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Start New Company Request
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            className="pl-8"
                            placeholder="Search master companies (code, name, segment)…"
                            value={companySearch}
                            onChange={(e) => setCompanySearch(e.target.value)}
                          />
                        </div>
                        <Select
                          value={selectedCompanyMasterKey}
                          onValueChange={setSelectedCompanyMasterKey}
                        >
                          <SelectTrigger
                            className="w-[320px]"
                            disabled={filteredCompanyMasters.length === 0}
                          >
                            <SelectValue
                              placeholder={
                                filteredCompanyMasters.length
                                  ? "Select company…"
                                  : "No master companies"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredCompanyMasters.map((row, idx) => {
                              const key = companyKeyFor(row, idx);
                              return (
                                <SelectItem key={key} value={key}>
                                  {companyMasterDisplay(row)}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={startChangeFromCompanyMaster}
                        disabled={!selectedCompanyMasterKey}
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Start Change Request
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Listing */}
            <Card className="bg-background/50 shadow-soft">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Building2 className="h-6 w-6 text-primary" />
                    <div>
                      <CardTitle>
                        {view === "my"
                          ? "Your Company Requests"
                          : "Company Codes"}
                      </CardTitle>
                      <CardDescription>
                        {view === "my"
                          ? "Manage your company code creation requests"
                          : "View existing company codes and create change requests"}
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {companyRequests.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No company code requests yet</p>
                    <p className="text-sm">
                      {view === "my"
                        ? "Create your first request to get started"
                        : "No records to display"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {companyRequests.map((request) => (
                      <div
                        key={request.id || request.requestId}
                        className="flex items-center justify-between p-4 border rounded-lg bg-background/50"
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <h3 className="font-semibold">
                              {view === "my"
                                ? request.title
                                : request.details?.companyCode ||
                                  "Company Code"}
                            </h3>
                            {getStatusBadge(request.status)}
                            {request.status === "completed" && (
                              <Badge variant="success">✓ Completed</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span>ID: {request.id || request.requestId}</span>
                            <span>Created by: {request.createdBy}</span>
                            <span>
                              Created:{" "}
                              {new Date(request.createdAt).toLocaleDateString()}
                            </span>
                            <span>
                              Updated:{" "}
                              {new Date(request.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          {view === "all" && request.details && (
                            <div className="mt-2 text-sm text-muted-foreground">
                              <span>
                                Name: {request.details.nameOfCompanyCode || "—"}
                              </span>
                              {request.details.shareholdingPercentage && (
                                <span className="ml-4">
                                  Share:{" "}
                                  {request.details.shareholdingPercentage}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedRequest(request)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          {canEdit(request) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingRequest(request);
                                setIsChangeFlow(view !== "my");
                                setShowCompanyForm(true);
                              }}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              {getEditLabel(request)}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </AccordionContent>
        </AccordionItem>

        {/* Plant Section */}
        <AccordionItem value="plant" className="border rounded-lg">
          <AccordionTrigger className="px-4">
            <div className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold">
                {view === "my" ? "Plant Code Requests" : "All Plant Codes"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {/* Action row */}
            <Card className="bg-gradient-card shadow-soft mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Action</CardTitle>
                <CardDescription>
                  Choose request type and proceed
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Request Type</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={plantMode === "new" ? "default" : "outline"}
                      onClick={() => setPlantMode("new")}
                    >
                      New
                    </Button>
                    <Button
                      size="sm"
                      variant={plantMode === "change" ? "default" : "outline"}
                      onClick={() => setPlantMode("change")}
                    >
                      Change
                    </Button>
                  </div>
                </div>

                {plantMode === "new" ? (
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      onClick={startNewPlant}
                      disabled={view !== "my"}
                      title={
                        view !== "my" ? "Switch to 'My Requests' to create" : ""
                      }
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Start New Plant Request
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            className="pl-8"
                            placeholder="Search master plants (code, name, company)…"
                            value={plantSearch}
                            onChange={(e) => setPlantSearch(e.target.value)}
                          />
                        </div>
                        <Select
                          value={selectedPlantMasterKey}
                          onValueChange={setSelectedPlantMasterKey}
                        >
                          <SelectTrigger
                            className="w-[320px]"
                            disabled={filteredPlantMasters.length === 0}
                          >
                            <SelectValue
                              placeholder={
                                filteredPlantMasters.length
                                  ? "Select plant…"
                                  : "No master plants"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredPlantMasters.map((row, idx) => {
                              const key = plantKeyFor(row, idx);
                              return (
                                <SelectItem key={key} value={key}>
                                  {plantMasterDisplay(row)}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={startChangeFromPlantMaster}
                        disabled={!selectedPlantMasterKey}
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Start Change Request
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Listing */}
            <Card className="bg-background/50 shadow-soft">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Building2 className="h-6 w-6 text-primary" />
                    <div>
                      <CardTitle>
                        {view === "my" ? "Your Plant Requests" : "Plant Codes"}
                      </CardTitle>
                      <CardDescription>
                        {view === "my"
                          ? "Manage your plant code creation requests"
                          : "View existing plant codes and create change requests"}
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {plantRequests.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No plant code requests yet</p>
                    <p className="text-sm">
                      {view === "my"
                        ? "Create your first request to get started"
                        : "No records to display"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {plantRequests.map((request) => (
                      <div
                        key={request.id || request.requestId}
                        className="flex items-center justify-between p-4 border rounded-lg bg-background/50"
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <h3 className="font-semibold">
                              {view === "my"
                                ? request.title
                                : request.details?.plantCode || "Plant Code"}
                            </h3>
                            {getStatusBadge(request.status)}
                            {request.status === "completed" && (
                              <Badge variant="success">✓ Completed</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span>ID: {request.id || request.requestId}</span>
                            <span>Created by: {request.createdBy}</span>
                            <span>
                              Created:{" "}
                              {new Date(request.createdAt).toLocaleDateString()}
                            </span>
                            <span>
                              Updated:{" "}
                              {new Date(request.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          {view === "all" && request.details && (
                            <div className="mt-2 text-sm text-muted-foreground">
                              <span>
                                Name: {request.details.nameOfPlant || "—"}
                              </span>
                              {request.details.companyCode && (
                                <span className="ml-4">
                                  Company: {request.details.companyCode}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedRequest(request)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          {canEdit(request) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingRequest(request);
                                setIsChangeFlow(view !== "my");
                                setShowPlantForm(true);
                              }}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              {getEditLabel(request)}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Dialogs */}
      {showPlantForm && (
        <PlantCodeForm
          open={showPlantForm}
          onOpenChange={(open) => {
            setShowPlantForm(open);
            if (!open) {
              setEditingRequest(null);
              setIsChangeFlow(false);
            }
          }}
          userEmail={userEmail}
          existingRequest={
            editingRequest?.type === "plant" ? editingRequest : undefined
          }
          isChangeRequest={isChangeFlow}
          onSuccess={() => {
            loadRequests();
            setShowPlantForm(false);
            setEditingRequest(null);
            setIsChangeFlow(false);
          }}
        />
      )}

      {showCompanyForm && (
        <CompanyCodeForm
          open={showCompanyForm}
          onOpenChange={(open) => {
            setShowCompanyForm(open);
            if (!open) {
              setEditingRequest(null);
              setIsChangeFlow(false);
            }
          }}
          userEmail={userEmail}
          existingRequest={
            editingRequest?.type === "company" ? editingRequest : undefined
          }
          isChangeRequest={isChangeFlow}
          onSuccess={() => {
            loadRequests();
            setShowCompanyForm(false);
            setEditingRequest(null);
            setIsChangeFlow(false);
          }}
        />
      )}

      {selectedRequest && !showPlantForm && !showCompanyForm && (
        <RequestDetailsDialog
          request={selectedRequest}
          open={!!selectedRequest}
          onOpenChange={(open) => !open && setSelectedRequest(null)}
        />
      )}
    </div>
  );
}
