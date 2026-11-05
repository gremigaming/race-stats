export interface ChangelogEntry {
  id: string;
  date: string;
  type: "feat" | "fix" | "docs";
  message: string;
  destination: "tracks" | "drivers" | "safety" | "personal-safety" | "race" | "incidents";
}

// Curated site updates. Keep these focused on changes visitors can notice;
// raw commit history also contains routine uploads and staff-only corrections.
const changelog: ChangelogEntry[] = [
  {
    id: "hidden-names-viewers",
    date: "2026-11-05",
    type: "fix",
    message:
      "Drivers with hidden names read from the classification screen now show by name in the race viewer and Incidents viewer too (no more \"Car #69\"), and in the qualifying before that race. A name read slightly differently in two races counts as one driver.",
    destination: "race",
  },
  {
    id: "incident-viewer",
    date: "2026-11-05",
    type: "feat",
    message:
      "New full-screen Incidents viewer: every incident on the track map with coloured markers by type, filters for drivers (or two drivers against each other), the stream's top 10 and awards in a folding side panel, and each incident replayed with the cars' lines and the two main drivers' live throttle, brake and steering. The menu fades while an incident plays.",
    destination: "incidents",
  },
  {
    id: "race-highlights",
    date: "2026-11-05",
    type: "feat",
    message:
      "The race viewer's timeline now shows highlights instead of every contact: big incidents, battles, overtakes, lead changes, fastest lap, photo finishes and more, with a Watch highlights button that plays them back to back.",
    destination: "race",
  },
  {
    id: "wet-weather-incidents",
    date: "2026-11-05",
    type: "feat",
    message:
      "Incidents in the wet are judged more leniently: the car behind gets more time to react and a slow slide into another car counts as a racing incident.",
    destination: "safety",
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
