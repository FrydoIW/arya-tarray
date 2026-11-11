import {
  BadgeCheck,
  ContactRound,
  Landmark,
  CircleGauge,
  FilePenLine,
  FileSearch,
  FileUp,
  KeyRound,
  Settings2,
  ShieldCheck,
  Tags,
  UserRound,
  UsersRound,
  type LucideIcon
} from "lucide-react";

export type NavigationChild = {
  menuCode: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  enabled: boolean;
};

export type NavigationGroup = {
  menuCode: string;
  label: string;
  icon: LucideIcon;
  children: NavigationChild[];
};

export const navigation: NavigationGroup[] = [
  {
    menuCode: "MONITORING",
    label: "Monitoring",
    icon: CircleGauge,
    children: [
      {
        menuCode: "MONITORING_DASHBOARD",
        label: "Dashboard",
        icon: CircleGauge,
        href: "/dashboard",
        enabled: true
      },
      {
        menuCode: "MONITORING_TIME_BASED",
        label: "Time Based Monitoring",
        icon: CircleGauge,
        href: "/monitoring/time-based",
        enabled: true
      },
      {
        menuCode: "MONITORING_CAMPAIGN",
        label: "Campaign Monitoring",
        icon: CircleGauge,
        href: "/monitoring/campaign",
        enabled: true
      }
    ]
  },
  {
    menuCode: "RECONCILIATION",
    label: "Reconciliation",
    icon: Settings2,
    children: [
      {
        menuCode: "RECON_STATEMENT_UPLOAD",
        label: "Statement Upload",
        icon: FileUp,
        href: "/reconciliation/statement-upload",
        enabled: true
      },
      {
        menuCode: "RECON_EDIT_INCOME",
        label: "Edit Income",
        icon: FilePenLine,
        href: "/reconciliation/edit-income",
        enabled: true
      },
      {
        menuCode: "RECON_TRANSACTION_INQUIRY",
        label: "Transaction Inquiry",
        icon: FileSearch,
        href: "/reconciliation/transaction-inquiry",
        enabled: true
      }
    ]
  },
  {
    menuCode: "APPROVAL_LINE",
    label: "Approval Line",
    icon: UsersRound,
    children: [
      {
        menuCode: "APPROVAL_SIGN",
        label: "Sign Approval",
        icon: BadgeCheck,
        href: "/approval/sign-approval",
        enabled: true
      }
    ]
  },
  {
    menuCode: "MEMBER",
    label: "Donatur",
    icon: UsersRound,
    children: [
      { menuCode: "MEMBER_REGISTRATION", label: "Registrasi Donatur", icon: UserRound, href: "/member/registration", enabled: true },
      { menuCode: "MEMBER_DATA", label: "Data Donatur", icon: ContactRound, href: "/member/data", enabled: true }
    ]
  },
  {
    menuCode: "CONFIGURATION",
    label: "Configuration",
    icon: Settings2,
    children: [
      {
        menuCode: "CONFIG_ROLE",
        label: "Role",
        icon: ShieldCheck,
        href: "/configuration/role",
        enabled: true
      },
      {
        menuCode: "CONFIG_USER",
        label: "User",
        icon: UserRound,
        href: "/configuration/user",
        enabled: true
      },
      {
        menuCode: "CONFIG_EVENT_CODE",
        label: "Event Code",
        icon: Tags,
        href: "/configuration/event-code",
        enabled: true
      },
      {
        menuCode: "CONFIG_APPROVAL",
        label: "Approval",
        icon: KeyRound,
        href: "/configuration/approval",
        enabled: true
      },
      {
        menuCode: "CONFIG_BANK_ACCOUNT",
        label: "Bank Account",
        icon: Landmark,
        href: "/configuration/bank-account",
        enabled: true
      }
    ]
  },
  {
    menuCode: "ACCOUNTING", label: "Accounting", icon: Landmark,
    children: [{ menuCode: "ACCOUNTING_REPORT", label: "Accounting", icon: Landmark, href: "/accounting", enabled: true }]
  }
];

export function getNavigationTitle(pathname: string) {
  return getNavigationByPathname(pathname)?.label ?? "Arya Tarray";
}

// Workspace subpages share the existing menu grant; they are not new registry/menu entries.
export function getWorkspaceNavigationPages(): NavigationChild[] {
  return [...navigation.flatMap(group => group.children),
    ...[
      ["/accounting/reports", "Accounting Reports"], ["/accounting/coa", "Chart of Accounts"],
      ["/accounting/journals", "Accounting Journals"], ["/accounting/approvals", "Accounting Approval"],
      ["/accounting/general-ledger", "General Ledger"], ["/accounting/trial-balance", "Trial Balance"],
      ["/accounting/periods", "Fiscal Years & Periods"],
      ["/accounting/payables", "Accounts Payable"], ["/accounting/receivables", "Accounts Receivable"],
      ["/accounting/accruals", "Accruals"], ["/accounting/schedules", "Prepayments & Deferred Income"],
      ["/accounting/assets", "Fixed Assets"],
      ["/accounting/funds", "Fund Accounting"],
      ["/accounting/financial-reports", "Financial Statements"],
      ["/accounting/reconciliation/bank", "Bank-to-GL Reconciliation"],
      ["/accounting/reconciliation/subledgers", "Subledger Reconciliation"],
      ["/accounting/reconciliation", "Accounting Reconciliation"],
      ["/accounting/closing", "Period & Year Closing"],
      ["/accounting/counterparties", "Counterparties"]
    ].map(([href, label]) => ({ menuCode: "ACCOUNTING_REPORT", label, icon: Landmark, href, enabled: true }))];
}

export function getNavigationByMenuCode(menuCode: string) {
  for (const group of navigation) {
    if (group.menuCode === menuCode) return group;
    const child = group.children.find((item) => item.menuCode === menuCode);
    if (child) return child;
  }

  return undefined;
}

export function getNavigationByPathname(pathname: string) {
  return getWorkspaceNavigationPages().filter(item => item.href && (item.href === pathname || pathname.startsWith(`${item.href}/`)))
    .sort((left, right) => (right.href?.length ?? 0) - (left.href?.length ?? 0))[0];
}

export function getDefaultNavigationPath(menuCodes: string[]) {
  const allowed = new Set(menuCodes);
  for (const group of navigation) {
    const child = group.children.find((item) => item.enabled && item.href && allowed.has(item.menuCode));
    if (child?.href) return child.href;
  }

  return "/access-denied";
}
