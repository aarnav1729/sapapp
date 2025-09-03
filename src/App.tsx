import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "@/components/auth/LoginPage";
import { Navigation } from "@/components/layout/Navigation";
import { RequestorDashboard } from "@/components/dashboard/RequestorDashboard";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { UserManagement } from "@/components/dashboard/UserManagement";
import { ITDashboard } from "@/components/dashboard/ITDashboard";
import { ApprovalDashboard } from "@/components/dashboard/ApprovalDashboard";
import { initDB, getSession } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import MasterCodes from "@/components/Masters/MasterCodes"; // ⬅️ NEW

const queryClient = new QueryClient();

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("");
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      await initDB();
      const session = await getSession();

      if (session) {
        setIsAuthenticated(true);
        setUserEmail(session.email);
        setUserRole(session.role);
        // Set default page based on role
        if (["secretary", "siva", "raghu", "manoj"].includes(session.role)) {
          setCurrentPage("approvals");
        }
        if (session.role === "it") {
          setCurrentPage("sap-updates");
        }
      }
    } catch (error) {
      console.error("Failed to initialize app:", error);
      toast({
        title: "Error",
        description: "Failed to initialize application",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (email: string, role: string) => {
    setIsAuthenticated(true);
    setUserEmail(email);
    setUserRole(role);
    // Set default page based on role
    if (["secretary", "siva", "raghu", "manoj"].includes(role)) {
      setCurrentPage("approvals");
    } else if (role === "it") {
      setCurrentPage("sap-updates");
    } else {
      setCurrentPage("dashboard");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserEmail("");
    setUserRole("");
    setCurrentPage("dashboard");
  };

  if (loading) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-gradient-surface flex items-center justify-center">
            <div className="text-center">
              <div className="bg-gradient-primary p-4 rounded-2xl shadow-medium inline-block mb-4">
                <div className="h-8 w-8 bg-white rounded animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Loading CCAS...
              </h2>
              <p className="text-muted-foreground">
                Initializing application...
              </p>
            </div>
          </div>
          <Toaster />
          <Sonner />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <LoginPage onLogin={handleLogin} />
          <Toaster />
          <Sonner />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        if (userRole === "admin") {
          return <AdminDashboard />;
        }
        return <RequestorDashboard userEmail={userEmail} />;
      case "masters": // ⬅️ NEW
        return <MasterCodes />;
      case "users":
        return <UserManagement />;
      case "all-requests":
        return <AdminDashboard />;
      case "sap-updates":
        return <ITDashboard userEmail={userEmail} />;
      case "approvals":
        return <ApprovalDashboard userEmail={userEmail} userRole={userRole} />;
      default:
        if (userRole === "admin") {
          return <AdminDashboard />;
        }
        return <RequestorDashboard userEmail={userEmail} />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-gradient-surface">
          <Navigation
            userEmail={userEmail}
            userRole={userRole}
            onLogout={handleLogout}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
          <main className="container mx-auto px-4 py-8">{renderPage()}</main>
        </div>
        <Toaster />
        <Sonner />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
