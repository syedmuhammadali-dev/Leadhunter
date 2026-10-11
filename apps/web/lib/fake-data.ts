import type { SearchHistoryItem } from "./types";

// FAKE development data. Search history becomes real when the n8n research jobs arrive (Phase 7).

/** Suggestions for the search form's city and country fields. */
export const LOCATIONS = [
  { country: "United Arab Emirates", city: "Dubai" },
  { country: "United Arab Emirates", city: "Abu Dhabi" },
  { country: "Pakistan", city: "Karachi" },
  { country: "Pakistan", city: "Lahore" },
  { country: "United Kingdom", city: "London" },
  { country: "Saudi Arabia", city: "Riyadh" },
] as const;

export const CATEGORIES = ["Restaurant", "Cafe", "Dentist", "Gym", "Bakery", "Salon", "Law Firm", "Clinic"] as const;

export const HISTORY: SearchHistoryItem[] = [
  { id: "job-006", country: "United Arab Emirates", city: "Dubai", category: "Restaurant", maxResults: 50, status: "COMPLETED", businessesFound: 50, websitesFound: 39, auditsCompleted: 39, highPriority: 14, createdAt: "2026-10-05T10:12:00Z" },
  { id: "job-005", country: "Pakistan", city: "Lahore", category: "Gym", maxResults: 30, status: "COMPLETED", businessesFound: 27, websitesFound: 15, auditsCompleted: 15, highPriority: 11, createdAt: "2026-10-04T16:40:00Z" },
  { id: "job-004", country: "United Kingdom", city: "London", category: "Bakery", maxResults: 25, status: "COMPLETED", businessesFound: 25, websitesFound: 24, auditsCompleted: 24, highPriority: 4, createdAt: "2026-10-03T09:05:00Z" },
  { id: "job-003", country: "Pakistan", city: "Karachi", category: "Dentist", maxResults: 40, status: "FAILED", businessesFound: 0, websitesFound: 0, auditsCompleted: 0, highPriority: 0, createdAt: "2026-10-02T13:22:00Z" },
  { id: "job-002", country: "Saudi Arabia", city: "Riyadh", category: "Cafe", maxResults: 20, status: "COMPLETED", businessesFound: 20, websitesFound: 16, auditsCompleted: 16, highPriority: 5, createdAt: "2026-10-01T11:48:00Z" },
  { id: "job-001", country: "United Arab Emirates", city: "Abu Dhabi", category: "Salon", maxResults: 15, status: "COMPLETED", businessesFound: 15, websitesFound: 10, auditsCompleted: 10, highPriority: 6, createdAt: "2026-09-30T08:30:00Z" },
];
