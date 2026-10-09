"use client";

import { ArrowBigDown, ArrowBigUp, ExternalLink, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { VOTEWANT_ORIGIN } from "@/core/links";
import { VoteWantFeedback, type FeedbackBoard, type FeedbackSubmission, type VoteDirection } from "@/core/votewant";

/**
 * Feedback: Peakly's VoteWant board, drawn natively. People request features, report bugs and
 * vote without signing in to anything: this install has an anonymous VoteWant voter credential,
 * kept on the device. Nothing about the user's apps, keys or reports is sent.
 * `openExternal` lets the Mac app open the full board in the browser.
 */
export function FeedbackView({ board, boardUrl, openExternal }: {
  readonly board: string | null;
  readonly boardUrl: string | null;
  readonly openExternal?: (url: string) => void;
}) {
  const client = useMemo(() => board ? new VoteWantFeedback(VOTEWANT_ORIGIN, board) : null, [board]);
  const [data, setData] = useState<FeedbackBoard | null>(null);
  const [myVotes, setMyVotes] = useState<Readonly<Record<string, VoteDirection>>>({});
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.getBoard()
      .then((loaded) => { if (!cancelled) setData(loaded); })
      .catch(() => { if (!cancelled) setLoadError("The feedback board couldn't be loaded. Check your connection, or open it in your browser."); });
    // Which buttons are pressed is a nicety; the board works without it.
    client.myVotes().then((votes) => { if (!cancelled) setMyVotes(votes); }).catch(() => {});
    return () => { cancelled = true; };
  }, [client]);

  async function vote(requestId: string, direction: VoteDirection) {
    if (!client) return;
    setMessage("");
    try {
      const result = await client.vote(requestId, direction);
      setMyVotes((votes) => ({ ...votes, [requestId]: direction }));
      setData((current) => current && {
        ...current,
        requests: current.requests.map((request) => request.id === requestId
          ? { ...request, downVoteCount: result.downVoteCount, participationVoteCount: result.participationVoteCount }
          : request),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your vote couldn't be saved.");
    }
  }

  async function submit(submission: FeedbackSubmission): Promise<boolean> {
    if (!client) return false;
    setMessage("");
    try {
      await client.submit(submission);
      setData(await client.getBoard());
      setMessage("Thanks, your feedback is on the board.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your feedback couldn't be sent.");
      return false;
    }
  }

  const allowDownvote = data?.appearance?.voteMode === "up_down";

  return (
    <div className="mx-auto max-w-[920px]">
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

      {!client ? (
        <p className="mt-6 rounded-2xl border border-line bg-card-muted px-5 py-4 text-sm text-ink-2" role="status">The feedback board isn&apos;t set up yet.</p>
      ) : (
        <>
          <FeedbackForm onSubmit={submit} />
          {message ? <p className="mt-3 text-sm text-ink-2" role="status">{message}</p> : null}
          {loadError ? (
            <p className="mt-6 rounded-2xl border border-line bg-card-muted px-5 py-4 text-sm text-ink-2" role="alert">{loadError}</p>
          ) : !data ? (
            <p className="mt-6 text-sm text-ink-3">Loading requests…</p>
          ) : data.requests.length === 0 ? (
            <p className="mt-6 text-sm text-ink-3">No requests yet. Be the first.</p>
          ) : (
            <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-card" aria-label="Requests">
              {data.requests.map((request) => (
                <li key={request.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{request.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{request.body}</p>
                    <p className="mt-1 text-xs capitalize text-ink-3">{request.type} · {request.status}</p>
                  </div>
                  <VoteButton active={myVotes[request.id] === "up"} count={request.participationVoteCount} direction="up"
                    label={`Upvote ${request.title}`} onVote={() => void vote(request.id, "up")} />
                  {allowDownvote ? (
                    <VoteButton active={myVotes[request.id] === "down"} count={request.downVoteCount} direction="down"
                      label={`Downvote ${request.title}`} onVote={() => void vote(request.id, "down")} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-ink-3">
        Feedback is hosted by VoteWant. No sign-in: this {openExternal ? "Mac" : "browser"} has an anonymous voter ID, and your apps, keys and reports never leave it.
      </p>
    </div>
  );
}

function VoteButton({ active, count, direction, label, onVote }: {
  readonly active: boolean;
  readonly count: number;
  readonly direction: VoteDirection;
  readonly label: string;
  readonly onVote: () => void;
}) {
  const Icon = direction === "up" ? ArrowBigUp : ArrowBigDown;
  return (
    <button type="button" aria-label={label} aria-pressed={active} disabled={active} onClick={onVote}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-sm font-semibold transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-transparent text-ink-2 hover:bg-card-muted"}`}>
      <Icon className="size-[18px]" aria-hidden />
      <span>{count}</span>
    </button>
  );
}

function FeedbackForm({ onSubmit }: { readonly onSubmit: (submission: FeedbackSubmission) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackSubmission["type"]>("request");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-6 flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
        <Send className="size-4" aria-hidden />Send feedback
      </button>
    );
  }

  return (
    <form className="mt-6 space-y-3 rounded-2xl border border-line bg-card p-5" aria-label="Send feedback"
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        const sent = await onSubmit({ body: body.trim(), title: title.trim(), type });
        setSending(false);
        if (sent) { setTitle(""); setBody(""); setOpen(false); }
      }}>
      <div className="flex gap-2" role="radiogroup" aria-label="Kind of feedback">
        {(["request", "issue"] as const).map((kind) => (
          <label key={kind} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${type === kind ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2"}`}>
            <input type="radio" name="kind" value={kind} checked={type === kind} onChange={() => setType(kind)} className="sr-only" />
            {kind === "request" ? "Request" : "Issue"}
          </label>
        ))}
      </div>
      <label className="block text-sm font-medium text-ink">Title
        <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-line bg-card px-3 py-2 text-[15px]" />
      </label>
      <label className="block text-sm font-medium text-ink">Details
        <textarea required maxLength={2000} rows={4} value={body} onChange={(event) => setBody(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-line bg-card px-3 py-2 text-[15px]" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={sending || !title.trim() || !body.trim()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Sending…" : "Send"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-ink-2 hover:bg-card-muted">Cancel</button>
      </div>
    </form>
  );
}
