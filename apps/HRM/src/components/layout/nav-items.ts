import type { UserRole } from ".prisma/hrm-client";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: UserRole[];
  group:
    | "main"
    | "hr"
    | "performance"
    | "finance"
    | "reports"
    | "tools"
    | "bottom";
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const navItems: NavItem[] = [
  // ── MAIN (no label) ──
  {
    label: "Dashboard",
    href: "/",
    icon: "LayoutDashboard",
    group: "main",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },

  // ── NHÂN SỰ ──
  {
    label: "Nhân Sự",
    href: "/employees",
    icon: "Users",
    group: "hr",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  },
  {
    label: "Tuyển Dụng",
    href: "/recruitment",
    icon: "UserPlus",
    group: "hr",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER"],
  },
  {
    label: "Biến Động NS",
    href: "/hr-events",
    icon: "GitPullRequest",
    group: "hr",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  },
  {
    label: "Offboarding",
    href: "/offboarding",
    icon: "LogOut",
    group: "hr",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER"],
  },

  // ── HIỆU SUẤT ──
  {
    label: "KPI",
    href: "/kpi",
    icon: "Target",
    group: "performance",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
    ],
  },
  {
    label: "Chấm Công",
    href: "/attendance",
    icon: "Clock",
    group: "performance",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },
  {
    label: "Đánh Giá",
    href: "/reviews",
    icon: "Star",
    group: "performance",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },

  // ── TÀI CHÍNH ──
  {
    label: "Lương",
    href: "/payroll",
    icon: "Wallet",
    group: "finance",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "ACCOUNTANT"],
  },
  {
    label: "Tạm Ứng",
    href: "/advances",
    icon: "Banknote",
    group: "finance",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },

  // ── BÁO CÁO / ĐƠN TỪ ──
  {
    label: "Đơn Từ",
    href: "/reports",
    icon: "FileText",
    group: "reports",
    roles: ["EMPLOYEE"],
  },
  {
    label: "Quản Lý Đơn",
    href: "/reports",
    icon: "FileText",
    group: "reports",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER"],
  },
  {
    label: "Báo Cáo TH",
    href: "/reports-hub",
    icon: "FileText",
    group: "reports",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  },
  {
    label: "Hồ Sơ Mẫu",
    href: "/templates",
    icon: "FolderOpen",
    group: "reports",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  },

  // ── CÔNG CỤ ──
  {
    label: "Phê Duyệt",
    href: "/approvals",
    icon: "ClipboardCheck",
    group: "tools",
    roles: ["SUPER_ADMIN", "HR_MANAGER", "DEPT_MANAGER"],
  },
  {
    label: "HR Copilot",
    href: "/copilot",
    icon: "Sparkles",
    group: "tools",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },
  {
    label: "Nhập Dữ Liệu",
    href: "/import",
    icon: "Upload",
    group: "tools",
    roles: ["SUPER_ADMIN"],
  },

  // ── BOTTOM (pinned, no label) ──
  {
    label: "Portal",
    href: "/portal",
    icon: "Smartphone",
    group: "bottom",
    roles: ["EMPLOYEE"],
  },
  {
    label: "Hồ Sơ",
    href: "/profile",
    icon: "UserCircle",
    group: "bottom",
    roles: [
      "SUPER_ADMIN",
      "HR_MANAGER",
      "HR_STAFF",
      "DEPT_MANAGER",
      "EMPLOYEE",
      "ACCOUNTANT",
    ],
  },
  {
    label: "Quản Trị",
    href: "/admin",
    icon: "Settings",
    group: "bottom",
    roles: ["SUPER_ADMIN"],
  },
];

const GROUP_ORDER: Array<{ key: NavItem["group"]; label: string | null }> = [
  { key: "main", label: null },
  { key: "hr", label: "Nhân sự" },
  { key: "performance", label: "Hiệu suất" },
  { key: "finance", label: "Tài chính" },
  { key: "reports", label: "Báo cáo" },
  { key: "tools", label: "Công cụ" },
  { key: "bottom", label: null },
];

export function getGroupedNavItems(role: UserRole): NavGroup[] {
  return GROUP_ORDER.map(({ key, label }) => ({
    label,
    items: navItems.filter(
      (item) => item.group === key && item.roles.includes(role),
    ),
  })).filter((group) => group.items.length > 0);
}

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return navItems.filter((item) => item.roles.includes(role));
}
