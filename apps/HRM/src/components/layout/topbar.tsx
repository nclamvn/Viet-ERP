"use client";

import { signOut } from "next-auth/react";
import { Menu, LogOut, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "@/components/search/command-palette";
import type { UserRole } from ".prisma/hrm-client";

const roleLabels: Record<UserRole, string> = {
  SUPER_ADMIN: "Quản trị viên",
  HR_MANAGER: "Trưởng phòng HR",
  HR_STAFF: "Chuyên viên HR",
  DEPT_MANAGER: "Quản lý phòng ban",
  EMPLOYEE: "Nhân viên",
  ACCOUNTANT: "Kế toán",
};

interface TopbarProps {
  userName: string;
  role: UserRole;
  onMenuClick: () => void;
}

export function Topbar({ userName, role, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Mở menu"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobile search */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Tìm kiếm"
        onClick={() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", metaKey: true }),
          );
        }}
      >
        <Search className="h-5 w-5" />
      </Button>

      {/* Search trigger */}
      <button
        onClick={() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", metaKey: true }),
          );
        }}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm text-slate-400 hover:bg-slate-50 transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>{"Tìm kiếm..."}</span>
        <kbd className="ml-4 text-[10px] border rounded px-1.5 py-0.5 bg-slate-50">
          {"⌘K"}
        </kbd>
      </button>
      <div className="flex-1 md:hidden" />

      <CommandPalette />

      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="text-right">
          <div className="text-sm font-medium">{userName}</div>
          <Badge variant="secondary" className="text-xs">
            {roleLabels[role]}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Đăng xuất"
          aria-label="Đăng xuất"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
