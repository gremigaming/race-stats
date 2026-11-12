export interface ChangelogEntry {
  id: string;
  date: string;
  type: "feat" | "fix" | "docs";
  title?: string;
  message: string;
  milestone?: boolean;
  destination:
    | "home"
    | "tracks"
    | "sessions"
    | "drivers"
    | "driver-dna"
    | "safety"
    | "personal-safety"
    | "race"
    | "incidents";
}

// Curated site updates. Keep these focused on changes visitors can notice;
// raw commit history also contains routine uploads and staff-only corrections.
const changelog: ChangelogEntry[] = [
  {
    id: "incident-race-timer",
    date: "2026-11-12",
    type: "feat",
    message:
      "Incidents show a race timer while they play, in the same minutes:seconds as the race viewer, and new incidents are kept smaller: at most 15 seconds, two corners and three drivers unless it's one pile-up.",
    destination: "incidents",
  },
  {
    id: "driver-dna-updates",
    date: "2026-11-12",
    type: "feat",
    message:
      "Driver DNA now combines richer archetypes and field-aware stats with profile fit history, radar charts, and linked leaderboards.",
    destination: "driver-dna",
  },
  {
    id: "stream-races-only",
    date: "2026-11-10",
    type: "fix",
    message:
      "Results, standings and safety ratings now only count races driven live on stream; offline races are left out automatically.",
    destination: "sessions",
  },
  {
    id: "track-page-polish",
    date: "2026-11-06",
    type: "fix",
    message: "Track filters no longer jump the page or hide behind panels.",
    destination: "tracks",
  },
  {
    id: "track-analysis",
    date: "2026-11-06",
    type: "feat",
    message:
      "Compare corner pace, sort tracks, and follow race and qualifying records.",
    destination: "tracks",
  },
  {
    id: "session-archive-search",
    date: "2026-11-06",
    type: "feat",
    message: "Search sessions by track and type.",
    destination: "sessions",
  },
  {
    id: "league-stats-highlights",
    date: "2026-11-06",
    type: "feat",
    message:
      "Compare expanded league stats and collision blame with one date filter.",
    destination: "drivers",
  },
  {
    id: "incident-viewer-updates",
    date: "2026-11-06",
    type: "feat",
    message:
      "Map, filter, and replay incidents; reviews include blame and steward decisions.",
    destination: "incidents",
  },
  {
    id: "site-ui-refresh",
    date: "2026-11-05",
    type: "feat",
    title: "A fresh look for GreMi Gang Race Stats",
    message: "A cleaner layout, calmer race cards, and simpler navigation.",
    milestone: true,
    destination: "home",
  },
  {
    id: "safety-rating-v25",
    date: "2026-11-04",
    type: "feat",
    message:
      "Safety Rating 2.5 uses your last 30 races and explains score changes.",
    destination: "personal-safety",
  },
  {
    id: "race-viewer-tools",
    date: "2026-11-02",
    type: "feat",
    message:
      "Follow races, jump to incidents, and share links to exact moments.",
    destination: "race",
  },
];

export default changelog;
