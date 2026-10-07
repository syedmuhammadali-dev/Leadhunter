import type { LeadStatus, Priority, Severity, WebsiteStatus } from "@/lib/types";

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

const PRIORITY_STYLE: Record<Priority, string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-slate-100 text-slate-700",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const label = { HIGH: "High priority", MEDIUM: "Medium priority", LOW: "Low priority" }[priority];
  return <Pill className={PRIORITY_STYLE[priority]}>{label}</Pill>;
}

const WEBSITE_STYLE: Record<WebsiteStatus, string> = {
  NO_WEBSITE: "bg-red-100 text-red-800",
  UNREACHABLE: "bg-orange-100 text-orange-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
};

export function WebsiteStatusBadge({ status }: { status: WebsiteStatus }) {
  const label = { NO_WEBSITE: "No website", UNREACHABLE: "Unreachable", ACTIVE: "Active" }[status];
  return <Pill className={WEBSITE_STYLE[status]}>{label}</Pill>;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Pill className="bg-blue-100 text-blue-800">{status.replace("_", " ")}</Pill>;
}

const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: "bg-red-200 text-red-900",
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-yellow-100 text-yellow-800",
  INFO: "bg-slate-100 text-slate-700",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Pill className={SEVERITY_STYLE[severity]}>{severity}</Pill>;
}
