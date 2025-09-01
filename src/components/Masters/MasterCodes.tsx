import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getMasterPlantCodes,
  getMasterCompanyCodes,
  PlantCodeMaster,
  CompanyCodeMaster,
} from "@/lib/storage";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MasterCodes() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [plantRows, setPlantRows] = useState<PlantCodeMaster[]>([]);
  const [companyRows, setCompanyRows] = useState<CompanyCodeMaster[]>([]);
  const [activeTab, setActiveTab] = useState<"plant" | "company">("plant");

  const [limit] = useState(1000);
  const [offset] = useState(0);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeTab]);

  async function load() {
    setLoading(true);
    try {
      if (activeTab === "plant") {
        const rows = await getMasterPlantCodes({ q, limit, offset });
        setPlantRows(rows);
      } else {
        const rows = await getMasterCompanyCodes({ q, limit, offset });
        setCompanyRows(rows);
      }
    } finally {
      setLoading(false);
    }
  }

  const plantCount = plantRows.length;
  const companyCount = companyRows.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Master Codes</h1>
        <p className="text-muted-foreground">
          Browse Plant & Company master code lists imported from Excel.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as any)}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="plant">Plant Codes</TabsTrigger>
          <TabsTrigger value="company">Company Codes</TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={
                  activeTab === "plant"
                    ? "Search plant code, name, orgs, project…"
                    : "Search company code, name, segment, CIN/PAN…"
                }
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
                aria-label="Search master codes"
              />
            </div>
          </CardContent>
        </Card>

        <TabsContent value="plant" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Plant Codes</CardTitle>
                <CardDescription>
                  {loading
                    ? "Loading…"
                    : `${plantCount} result${plantCount === 1 ? "" : "s"}`}
                </CardDescription>
              </div>
              <Badge variant="outline">Up to {limit} rows</Badge>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Plant</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Purchase Org</TableHead>
                    <TableHead>Sales Org</TableHead>
                    <TableHead>Profit Center</TableHead>
                    <TableHead>Project Code</TableHead>
                    <TableHead>Storage Loc.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plantRows.map((r) => (
                    <TableRow key={`${r.companyCode}-${r.plantCode}`}>
                      <TableCell className="font-mono">
                        {r.companyCode}
                      </TableCell>
                      <TableCell className="font-mono">{r.plantCode}</TableCell>
                      <TableCell className="max-w-[320px] truncate">
                        {r.nameOfPlant || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.purchaseOrganization || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.salesOrganization || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.profitCenter || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.projectCode || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.storageLocationCode || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && plantRows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center text-muted-foreground"
                      >
                        No results
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {loading && (
                <div className="text-sm text-muted-foreground p-2">
                  Loading…
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Company Codes</CardTitle>
                <CardDescription>
                  {loading
                    ? "Loading…"
                    : `${companyCount} result${companyCount === 1 ? "" : "s"}`}
                </CardDescription>
              </div>
              <Badge variant="outline">Up to {limit} rows</Badge>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Shareholding %</TableHead>
                    <TableHead>Segment</TableHead>
                    <TableHead>Segment Name</TableHead>
                    <TableHead>CIN</TableHead>
                    <TableHead>PAN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companyRows.map((r) => (
                    <TableRow key={r.companyCode}>
                      <TableCell className="font-mono">
                        {r.companyCode}
                      </TableCell>
                      <TableCell className="max-w-[400px] truncate">
                        {r.nameOfCompanyCode}
                      </TableCell>
                      <TableCell className="font-mono">
                        {typeof r.shareholdingPercentage === "number"
                          ? `${r.shareholdingPercentage}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.segment || "—"}
                      </TableCell>
                      <TableCell>{r.nameOfSegment || "—"}</TableCell>
                      <TableCell className="font-mono">
                        {r.cin || "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.pan || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && companyRows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        No results
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {loading && (
                <div className="text-sm text-muted-foreground p-2">
                  Loading…
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
