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
    id: "track-page-polish",
    date: "2026-11-06",
    type: "fix",
    message:
      "Dropdowns stay above other panels and no longer jump the page.",
    destination: "tracks",
  },
  {
    id: "driver-dna-cards",
    date: "2026-11-06",
    type: "feat",
    message:
      "Explore drivers' racing styles, see the stats behind each profile, and copy Driver DNA cards as PNGs for Discord.",
    destination: "driver-dna",
  },
  {
    id: "track-analysis",
    date: "2026-11-06",
    type: "feat",
    message:
      "Compare pace corner by corner or against the field, sort tracks, and follow race and qualifying record holders over time.",
    destination: "tracks",
  },
  {
    id: "session-archive-search",
    date: "2026-11-06",
    type: "feat",
    message:
      "Find sessions faster with track search and session-type filters.",
    destination: "sessions",
  },
  {
    id: "league-stats-highlights",
    date: "2026-11-06",
    type: "feat",
    message:
      "See expanded league stats and who had the most collisions where someone else was at fault, with one date filter.",
    destination: "drivers",
  },
  {
    id: "incident-viewer-updates",
    date: "2026-11-06",
    type: "feat",
    message:
      "Review incidents on a map, filter by driver or type, and replay each moment. Open reviews from Safety Rating; calls match its blame and severity, including stewards' decisions.",
    destination: "incidents",
  },
  {
    id: "site-ui-refresh",
    date: "2026-11-05",
    type: "feat",
    title: "A fresh look for GreMi Gang Race Stats",
    message:
      "A refreshed site with clearer navigation, calmer race cards, and easier-to-use pages.",
    milestone: true,
    destination: "home",
  },
  {
    id: "safety-rating-v25",
    date: "2026-11-04",
    type: "feat",
    message:
      "See how Safety Rating 2.5 uses your last 30 races and what affects each score change.",
    destination: "personal-safety",
  },
  {
    id: "race-viewer-tools",
    date: "2026-11-02",
    type: "feat",
    message:
      "Follow live and recorded races, check the running order, jump to incidents, and share links to exact moments.",
    destination: "race",
  },
];

export default changelog;
