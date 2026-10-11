export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type WebsiteStatus = "NO_WEBSITE" | "ACTIVE" | "UNREACHABLE" | "ERROR" | "UNKNOWN";
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

/** One row of GET /api/leads. */
export interface LeadItem {
  id: string;
  businessId: string;
  name: string;
  category: string;
  country: string;
  city: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  websiteStatus: WebsiteStatus;
  websiteScore: number | null;
  auditStatus: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED" | null;
  score: number | null;
  maximumScore: number | null;
  priority: Priority | null;
  status: LeadStatus;
  problems: string[];
  source: string;
  scoredAt: string | null;
  lastAuditedAt: string | null;
}

export interface LeadList {
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  items: LeadItem[];
}

export interface SignalDetail {
  signal: string;
  label: string;
  weight: number;
  matched: boolean;
  evaluated: boolean;
}

/** GET /api/leads/:id */
export interface LeadDetail extends LeadItem {
  email: string | null;
  sourceUrl: string | null;
  notes: string | null;
  tags: string[];
  contactMethods: { type: string; value: string; source: string }[];
  latestScore: {
    score: number;
    maximumScore: number;
    priority: Priority;
    reasons: string[];
    details: { signals: SignalDetail[]; notes: string[] };
    configVersion: string | null;
    calculatedAt: string;
  } | null;
  scoreHistory: { score: number; priority: Priority; configVersion: string | null; calculatedAt: string }[];
}

export interface LeadStats {
  total: number;
  byPriority: { HIGH: number; MEDIUM: number; LOW: number; unscored: number };
  noWebsite: number;
  averageScore: number | null;
  topLeads: LeadItem[];
}

/** GET /api/scoring/config */
export interface ScoringConfigView {
  version: string;
  maximumScore: number;
  thresholds: { high: number; medium: number };
  signals: Record<string, { label: string; weight: number; issueTypes?: string[] }>;
  presence: { minReviews: number; weight: number; label: string }[];
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
