export interface ChangelogEntry {
  id: string;
  date: string;
  type: "feat" | "fix" | "docs";
  message: string;
  destination: "tracks" | "drivers" | "safety" | "personal-safety" | "race";
}

// Curated site updates. Keep these focused on changes visitors can notice;
// raw commit history also contains routine uploads and staff-only corrections.
const changelog: ChangelogEntry[] = [
  {
    id: "corner-analysis",
    date: "2026-11-03",
    type: "feat",
    message: "Compare driver performance corner by corner.",
    destination: "tracks",
  },
  {
    id: "expanded-league-views",
    date: "2026-11-03",
    type: "feat",
    message: "Explore expanded league stats with one shared date filter.",
    destination: "drivers",
  },
  {
    id: "safety-rating-scoring",
    date: "2026-11-03",
    type: "fix",
    message:
      "See the revised Safety Rating rules for incident deductions, shared fault, instant sting, and race penalties.",
    destination: "safety",
  },
  {
    id: "incident-history",
    date: "2026-11-03",
    type: "feat",
    message:
      "Review each driver's incident call and severity, including AI and hidden-name cars.",
    destination: "personal-safety",
  },
  {
    id: "live-race-viewer",
    date: "2026-11-02",
    type: "feat",
    message: "Follow an ongoing race as new live data arrives.",
    destination: "race",
  },
  {
    id: "race-share-links",
    date: "2026-10-30",
    type: "feat",
    message: "Share a race link that opens directly at the selected moment.",
    destination: "race",
  },
  {
    id: "race-timing-tower",
    date: "2026-10-29",
    type: "feat",
    message: "Follow the running order in the race viewer's timing tower.",
    destination: "race",
  },
  {
    id: "race-replays",
    date: "2026-10-29",
    type: "feat",
    message: "Replay recorded races and jump to contacts from the incident list.",
    destination: "race",
  },
];

export default changelog;
