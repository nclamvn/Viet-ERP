"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Wallet,
  FileText,
  GitPullRequest,
  LogOut,
  ClipboardCheck,
  Sparkles,
  Settings,
  UserCircle,
  Clock,
  Target,
  FolderOpen,
  Upload,
  Banknote,
  Star,
  ChevronsLeft,
  ChevronsRight,
  HelpCircle,
} from "lucide-react";
import { getGroupedNavItems } from "./nav-items";
import type { UserRole } from ".prisma/hrm-client";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard,
  Users,
  UserPlus,
  GitPullRequest,
  Wallet,
  FileText,
  LogOut,
  ClipboardCheck,
  Sparkles,
  Settings,
  UserCircle,
  Clock,
  Target,
  FolderOpen,
  Upload,
  Banknote,
  Star,
};

interface SidebarProps {
  role: UserRole;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  role,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const groups = getGroupedNavItems(role);

  const mainGroups = groups.filter(
    (g) => g.label !== null || g.items[0]?.href === "/",
  );
  const bottomGroup = groups.find(
    (g) => g.label === null && g.items[0]?.href !== "/",
  );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full flex flex-col text-white transition-all duration-200 md:translate-x-0 md:sticky md:top-0 md:z-auto md:h-screen md:shrink-0",
          collapsed ? "w-[60px]" : "w-64",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ backgroundColor: "#1E3A5F" }}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-white/10",
            collapsed ? "justify-center px-2" : "justify-between px-6",
          )}
        >
          {!collapsed && (
            <div className="font-semibold text-sm">VietERP HRM</div>
          )}
          <button
            onClick={onToggleCollapse}
            className="hidden md:flex items-center justify-center h-7 w-7 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            title={collapsed ? "Mở rộng" : "Thu gọn"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav
          className={cn(
            "mt-2 overflow-y-auto flex-1",
            collapsed ? "px-1.5" : "px-3",
          )}
        >
          {mainGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && !collapsed && (
                <div className="text-[11px] uppercase tracking-wider text-white/50 font-semibold px-3 mt-3 mb-1">
                  {group.label}
                </div>
              )}
              {group.label && collapsed && (
                <div className="border-t border-white/10 my-2 mx-1" />
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = iconMap[item.icon] || LayoutDashboard;
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href ||
                        pathname.startsWith(item.href + "/");

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center rounded-lg text-[13px] font-medium transition-colors",
                        collapsed
                          ? "justify-center px-0 py-2"
                          : "gap-2.5 px-3 py-1.5",
                        isActive
                          ? "bg-white/15 text-white font-medium"
                          : "text-white/70 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        {bottomGroup && (
          <div
            className={cn(
              "border-t border-white/10 pt-2 pb-1",
              collapsed ? "px-1.5" : "px-3",
            )}
          >
            <div className="space-y-0.5">
              {bottomGroup.items.map((item) => {
                const Icon = iconMap[item.icon] || LayoutDashboard;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center rounded-lg text-[13px] font-medium transition-colors",
                      collapsed
                        ? "justify-center px-0 py-2"
                        : "gap-2.5 px-3 py-1.5",
                      isActive
                        ? "bg-white/15 text-white font-semibold"
                        : "text-white/80 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Help Center — amber accent */}
        <div
          className={cn(
            "border-t border-white/10 pt-2 pb-1",
            collapsed ? "px-1.5" : "px-3",
          )}
        >
          <Link
            href="/help"
            onClick={onClose}
            title={collapsed ? "Hướng Dẫn" : undefined}
            className={cn(
              "flex items-center rounded-lg text-[13px] font-medium transition-colors",
              collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-1.5",
              pathname === "/help" || pathname.startsWith("/help/")
                ? "bg-amber-400/20 text-amber-300"
                : "text-amber-400/80 hover:bg-amber-400/10 hover:text-amber-300",
            )}
          >
            <HelpCircle className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && "Hướng Dẫn"}
          </Link>
        </div>

        <div className="pb-3" />
      </aside>
    </>
  );
}
