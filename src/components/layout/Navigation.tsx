import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building,
  User,
  LogOut,
  Bell,
  Settings,
  FileText,
  Users,
  Database,
  FileSpreadsheet, // ⬅️ NEW: icon for Master Codes
} from "lucide-react";
import { clearSession } from "@/lib/storage";

interface NavigationProps {
  userEmail: string;
  userRole: string;
  onLogout: () => void;
  currentPage: string;
  onPageChange: (page: string) => void;
}

export function Navigation({
  userEmail,
  userRole,
  onLogout,
  currentPage,
  onPageChange,
}: NavigationProps) {
  const [showNotifications, setShowNotifications] = useState(false);

  const handleLogout = async () => {
    await clearSession();
    onLogout();
  };

  const getRoleDisplay = (role: string) => {
    const roleMap = {
      requestor: "Requestor",
      it: "IT Team",
      secretary: "Secretary",
      finance: "Finance",
      raghu: "Raghu",
      siva: "Siva",
      admin: "Administrator",
    };
    return (roleMap as any)[role] || role;
  };

  const getRoleVariant = (role: string) => {
    const variantMap = {
      requestor: "secondary" as const,
      it: "default" as const,
      secretary: "warning" as const,
      finance: "warning" as const,
      raghu: "warning" as const,
      siva: "success" as const,
      admin: "destructive" as const,
    };
    return (variantMap as any)[role] || "secondary";
  };

  const getNavigationItems = (role: string) => {
    // ⬅️ NEW: "Master Codes" available to all roles
    const baseItems = [
      { key: "dashboard", label: "Dashboard", icon: FileText },
      { key: "masters", label: "Master Codes", icon: FileSpreadsheet },
    ];

    if (role === "admin") {
      return [
        ...baseItems,
        { key: "users", label: "User Management", icon: Users },
        { key: "all-requests", label: "All Requests", icon: Database },
      ];
    }

    if (role === "it") {
      return [
        ...baseItems,
        { key: "sap-updates", label: "SAP Updates", icon: Database },
      ];
    }

    if (["secretary", "finance", "raghu", "siva"].includes(role)) {
      return [
        ...baseItems,
        { key: "approvals", label: "Pending Approvals", icon: FileText },
      ];
    }

    return baseItems;
  };

  const navigationItems = getNavigationItems(userRole);

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center">
        {/* Logo */}
        <div className="flex items-center space-x-2 mr-8">
          <div className="bg-gradient-primary p-2 rounded-lg">
            <Building className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-foreground">
            PEL Workflow
          </span>
        </div>

        {/* Navigation Items */}
        <div className="flex space-x-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.key}
                variant={currentPage === item.key ? "default" : "ghost"}
                size="sm"
                onClick={() => onPageChange(item.key)}
                className="flex items-center space-x-2"
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center space-x-4">
          {/* Notifications */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              3
            </Badge>
          </Button>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center space-x-2"
                aria-label="User menu"
              >
                <div className="flex items-center space-x-2">
                  <div className="bg-primary/10 p-2 rounded-full">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium">{userEmail}</p>
                    <Badge
                      variant={getRoleVariant(userRole)}
                      className="text-xs"
                    >
                      {getRoleDisplay(userRole)}
                    </Badge>
                  </div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {userEmail}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {getRoleDisplay(userRole)}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}
