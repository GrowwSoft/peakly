"use client";

import { ArrowBigDown, ArrowBigUp, ExternalLink, MessageSquareText, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CALENDLY_URL, VOTEWANT_ORIGIN } from "@/core/links";
import { VoteWantFeedback, type FeedbackBoard, type FeedbackComment, type FeedbackSubmission, type VoteDirection } from "@/core/votewant";

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
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Readonly<Record<string, readonly FeedbackComment[]>>>({});
  const [commentDrafts, setCommentDrafts] = useState<Readonly<Record<string, string>>>({});
  const [commentConsent, setCommentConsent] = useState<Readonly<Record<string, boolean>>>({});
  const [loadingComments, setLoadingComments] = useState<Readonly<Record<string, boolean>>>({});
  const [sendingComment, setSendingComment] = useState<string | null>(null);
  const [commentError, setCommentError] = useState("");

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

  async function toggleComments(requestId: string) {
    if (!client) return;
    setCommentError("");
    if (openComments === requestId) {
      setOpenComments(null);
      return;
    }
    setOpenComments(requestId);
    setLoadingComments((current) => ({ ...current, [requestId]: true }));
    try {
      const loaded = await client.getComments(requestId);
      setComments((current) => ({ ...current, [requestId]: loaded }));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Comments couldn't be loaded.");
    } finally {
      setLoadingComments((current) => ({ ...current, [requestId]: false }));
    }
  }

  async function submitComment(requestId: string) {
    if (!client) return;
    const body = commentDrafts[requestId]?.trim() ?? "";
    if (!body || !commentConsent[requestId]) return;
    setCommentError("");
    setSendingComment(requestId);
    try {
      await client.comment(requestId, body);
      const [loadedComments, loadedBoard] = await Promise.all([client.getComments(requestId), client.getBoard()]);
      setComments((current) => ({ ...current, [requestId]: loadedComments }));
      setData(loadedBoard);
      setCommentDrafts((current) => ({ ...current, [requestId]: "" }));
      setMessage("Your comment is on the board.");
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Your comment couldn't be sent.");
    } finally {
      setSendingComment(null);
    }
  }

  const allowDownvote = data?.appearance?.voteMode === "up_down";

  return (
    <div className="mx-auto max-w-[920px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-ink sm:text-[44px]">Feedback</h1>
          <p className="mt-2 text-[17px] text-ink-2">Request a feature, report a bug, discuss ideas, and vote on what should get built first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer"
            onClick={openExternal ? (e) => { e.preventDefault(); openExternal(CALENDLY_URL); } : undefined}
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            Book a one-to-one<ExternalLink className="size-4" aria-hidden />
          </a>
          {boardUrl && (
            <a href={boardUrl} target="_blank" rel="noopener noreferrer"
              onClick={openExternal ? (e) => { e.preventDefault(); openExternal(boardUrl); } : undefined}
              className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              Open the board in your browser<ExternalLink className="size-4" aria-hidden />
            </a>
          )}
        </div>
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
                <li key={request.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <button type="button" aria-expanded={openComments === request.id}
                      aria-controls={`comments-${request.id}`}
                      aria-label={`${openComments === request.id ? "Hide" : "Open"} discussion for ${request.title}`}
                      onClick={() => void toggleComments(request.id)}
                      className="group min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                      <p className="font-semibold text-ink group-hover:text-accent">{request.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{request.body}</p>
                      <p className="mt-1 text-xs capitalize text-ink-3">{request.type} · {request.status}</p>
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                        <MessageSquareText className="size-3.5" aria-hidden />
                        {openComments === request.id ? "Hide discussion" : "Read or add a comment"}
                        <span className="font-normal text-ink-3">· {request.commentCount ?? comments[request.id]?.length ?? 0}</span>
                      </span>
                    </button>
                    <VoteButton active={myVotes[request.id] === "up"} count={request.participationVoteCount} direction="up"
                      label={`Upvote ${request.title}`} onVote={() => void vote(request.id, "up")} />
                    {allowDownvote ? (
                      <VoteButton active={myVotes[request.id] === "down"} count={request.downVoteCount} direction="down"
                        label={`Downvote ${request.title}`} onVote={() => void vote(request.id, "down")} />
                    ) : null}
                  </div>
                  {openComments === request.id ? (
                    <section id={`comments-${request.id}`} className="mt-4 rounded-xl border border-line bg-card-muted/50 p-4" aria-label={`Comments on ${request.title}`}>
                      <h2 className="text-sm font-semibold text-ink">Discussion</h2>
                      {commentError ? <p className="mt-2 text-sm text-bad" role="alert">{commentError}</p> : null}
                      {loadingComments[request.id] ? <p className="mt-2 text-sm text-ink-3">Loading comments…</p> : null}
                      {!loadingComments[request.id] && (comments[request.id]?.length ?? 0) === 0 && !commentError ? <p className="mt-2 text-sm text-ink-3">No comments yet. Add useful context or ask a question.</p> : null}
                      <ul className="mt-3 space-y-3">
                        {(comments[request.id] ?? []).map((comment) => (
                          <li key={comment.id} className="rounded-lg bg-card px-3 py-2.5">
                            <p className="whitespace-pre-wrap text-sm text-ink">{comment.body}</p>
                            <p className="mt-1 text-xs text-ink-3">{comment.authorLabel} · {comment.provenanceLabel}</p>
                          </li>
                        ))}
                      </ul>
                      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void submitComment(request.id); }}>
                        <label className="block text-sm font-medium text-ink">Add a comment
                          <textarea value={commentDrafts[request.id] ?? ""} maxLength={2000} rows={3}
                            onChange={(event) => setCommentDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                            className="mt-1 block w-full rounded-xl border border-line bg-card px-3 py-2 text-[15px]" />
                        </label>
                        <label className="flex items-start gap-2 text-xs text-ink-2">
                          <input type="checkbox" checked={commentConsent[request.id] ?? false}
                            onChange={(event) => setCommentConsent((current) => ({ ...current, [request.id]: event.target.checked }))} />
                          <span>I understand this comment will be public and won&apos;t include personal or account data.</span>
                        </label>
                        <button type="submit" disabled={sendingComment === request.id || !commentDrafts[request.id]?.trim() || !commentConsent[request.id]}
                          className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          {sendingComment === request.id ? "Posting…" : "Post comment"}
                        </button>
                      </form>
                    </section>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-ink-3">
        Comments are public and show this install&apos;s stable anonymous ID. Only feedback and votes are sent to VoteWant; App Store Connect credentials and reports stay on {openExternal ? "this Mac" : "the server running Peakly"}.
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
