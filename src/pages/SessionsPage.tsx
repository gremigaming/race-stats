import { CalendarDays } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import { SessionList } from "../components/SessionList";
import { PageFrame } from "../components/ui/PageFrame";
import { PageHeader } from "../components/ui/PageHeader";

export function SessionsPage() {
  const { activeFormula, league } = useTelemetry();

  return (
    <PageFrame>
      <PageHeader
        icon={CalendarDays}
        eyebrow="Race archive"
        title="Sessions"
        description="Browse races, qualifying, and time trials from your saved history."
        meta={`${activeFormula?.label ?? "All games"} · ${league?.filterLabel ?? "All available dates"}`}
      />
      <section className="rounded-2xl bg-zinc-900/45 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <SessionList section="sessions" showAllSessions />
      </section>
    </PageFrame>
  );
}
