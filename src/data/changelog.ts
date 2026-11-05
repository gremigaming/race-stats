export interface ChangelogEntry {
  id: string;
  date: string;
  type: "feat" | "fix" | "docs";
  message: string;
  destination: "home" | "tracks" | "drivers" | "safety" | "personal-safety" | "race" | "incidents";
}

// Curated site updates. Keep these focused on changes visitors can notice;
// raw commit history also contains routine uploads and staff-only corrections.
const changelog: ChangelogEntry[] = [
  {
    id: "incident-viewer",
    date: "2026-11-05",
    type: "feat",
    message:
      "Browse race incidents on a track map, filter by driver and incident type, and replay each moment.",
    destination: "incidents",
  },
  {
    id: "site-ui-refresh",
    date: "2026-11-05",
    type: "feat",
    message:
      "The GreMi Gang Race Stats site has a refreshed look, with clearer navigation, a more focused home page, calmer race cards, and cleaner layouts across its tools.",
    destination: "home",
  },
  {
    id: "track-sorting-options",
    date: "2026-11-04",
    type: "feat",
    message:
      "Sort tracks by the default calendar order, session count, best race result, or race pace against the field.",
    destination: "tracks",
  },
  {
    id: "track-race-pace-vs-field",
    date: "2026-11-04",
    type: "feat",
    message:
      "Track cards now show your race pace against the field alongside Race and Qualifying, with a detailed pace comparison in track insights.",
    destination: "tracks",
  },
  {
    id: "safety-rating-breakdown",
    date: "2026-11-04",
    type: "feat",
    message:
      "Your Safety Rating page now shows the math: every penalty with its SR-tier and dirty-streak multipliers, gravity in each race's number, skipped streams, and how older races fade, adding up to each stream's SR change.",
    destination: "personal-safety",
  },
  {
    id: "safety-rating-v25",
    date: "2026-11-04",
    type: "feat",
    message:
      "Safety Rating 2.5: your last 30 races add up, dirty races earn no bonus, penalties grow with your SR, and gravity pulls you back towards 50.",
    destination: "safety",
  },
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
