import { Bot } from "lucide-react";

const TOOLS = [
  { name: "list_apps", description: "Apps visible to the connected App Store Connect key." },
  { name: "get_growth_summary", description: "KPIs, period-over-period change and data coverage for an app and date range." },
  { name: "get_insights", description: "The recommended next steps with the evidence behind each one." },
  { name: "get_source_breakdown", description: "Impressions, page views and downloads by App Store source." },
];

export function McpView() {
  return (
    <div className="mx-auto max-w-[880px]">
      <div className="flex items-center gap-4">
        <div className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
          <Bot className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-ink sm:text-[44px]">MCP</h1>
        </div>
        <span className="ml-auto rounded-full bg-card-muted px-3 py-1 text-xs font-medium text-ink-3 ring-1 ring-line">Coming soon</span>
      </div>
      <p className="mt-3 text-[17px] text-ink-2">
        Ask Claude and other AI assistants about your app&apos;s growth. The MCP server will expose the same read-only reports and insights you see here. It won&apos;t expose your keys, and it can&apos;t change anything in App Store Connect.
      </p>

      <section className="mt-8 rounded-2xl border border-line bg-card p-6">
        <h2 className="text-xl font-semibold text-ink">Planned tools</h2>
        <ul className="mt-4 divide-y divide-line">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <code className="w-56 shrink-0 font-mono text-sm text-ink">{tool.name}</code>
              <span className="text-sm text-ink-2">{tool.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
