export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type WebsiteStatus = "NO_WEBSITE" | "ACTIVE" | "UNREACHABLE";
export type LeadStatus =
  | "NEW"
  | "RESEARCHED"
  | "CONTACTED"
  | "REPLIED"
  | "INTERESTED"
  | "MEETING"
  | "PROPOSAL"
  | "WON"
  | "LOST"
  | "FOLLOW_UP";
export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AuditIssue {
  type: string;
  severity: Severity;
  title: string;
  explanation: string;
  evidence?: string;
  pointsDeducted: number;
}

export interface Audit {
  url: string;
  httpStatus: number;
  usesHttps: boolean;
  websiteScore: number;
  issues: AuditIssue[];
  auditedAt: string;
}

export interface ScoreSignal {
  label: string;
  weight: number;
}

export interface Lead {
  id: string;
  name: string;
  category: string;
  country: string;
  city: string;
  address: string;
  website: string | null;
  phone: string;
  rating: number;
  reviewCount: number;
  websiteStatus: WebsiteStatus;
  score: number;
  maxScore: number;
  priority: Priority;
  signals: ScoreSignal[];
  problems: string[];
  status: LeadStatus;
  audit: Audit | null;
  source: string;
  researchedAt: string;
}

export interface SearchHistoryItem {
  id: string;
  country: string;
  city: string;
  category: string;
  maxResults: number;
  status: "COMPLETED" | "RUNNING" | "FAILED";
  businessesFound: number;
  websitesFound: number;
  auditsCompleted: number;
  highPriority: number;
  createdAt: string;
}
