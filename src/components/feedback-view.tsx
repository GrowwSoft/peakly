import { ExternalLink } from "lucide-react";

/**
 * Feedback: Peakly's VoteWant board, embedded. People request features, report bugs and vote on
 * what others asked for. The board is a votewant.com page in a frame; nothing about the user's
 * apps or keys goes there. `openExternal` lets the Mac app open the board in the browser.
 */
export function FeedbackView({ boardUrl, openExternal }: { boardUrl: string | null; openExternal?: (url: string) => void }) {
  return (
    <div className="mx-auto max-w-[1240px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-ink sm:text-[44px]">Feedback</h1>
          <p className="mt-2 text-[17px] text-ink-2">Request a feature, report a bug, or vote on what others asked for. The most-wanted ideas get built first.</p>
        </div>
        {boardUrl && (
          <a href={boardUrl} target="_blank" rel="noopener noreferrer"
            onClick={openExternal ? (e) => { e.preventDefault(); openExternal(boardUrl); } : undefined}
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            Open the board in your browser<ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </header>
      {boardUrl ? (
        <iframe src={boardUrl} title="Peakly feedback board on VoteWant" className="mt-6 h-[min(760px,calc(100vh-220px))] min-h-[480px] w-full rounded-2xl border border-line bg-card" />
      ) : (
        <p className="mt-6 rounded-2xl border border-line bg-card-muted px-5 py-4 text-sm text-ink-2" role="status">The feedback board isn&apos;t set up yet.</p>
      )}
      <p className="mt-3 text-xs text-ink-3">Feedback is hosted by VoteWant. Your apps, keys and reports never leave this {openExternal ? "Mac" : "server"}.</p>
    </div>
  );
}
