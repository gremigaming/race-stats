import { useTelemetry } from "../context/TelemetryContext";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SessionList } from "../components/SessionList";

export function SessionsPage() {
  const { activeFormula, league } = useTelemetry();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <SectionHeader
        title="All sessions"
        hint={`${activeFormula?.label ?? "All games"} · ${league?.filterLabel ?? "All available dates"}`}
      />
      <section className="rounded-2xl bg-zinc-900/45 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <SessionList section="sessions" showAllSessions />
      </section>
    </div>
  );
}
