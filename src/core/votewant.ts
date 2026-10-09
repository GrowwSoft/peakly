/**
 * The few VoteWant calls the Feedback screen needs, typed to VoteWant's public contract.
 * Switch to `@growwsoft/votewant-client` (VoteWantClient / VoteWantVoterClient) once it is
 * published to npm; until then this mirrors its shapes.
 *
 * People vote and send feedback without signing in to anything. Each Peakly install
 * registers once for an anonymous VoteWant voter credential, kept on this device. It names
 * no person and carries nothing about the user's apps, keys or reports.
 */

export interface FeedbackRequest {
  readonly body: string;
  readonly commentCount?: number;
  readonly downVoteCount: number;
  readonly id: string;
  readonly participationVoteCount: number;
  readonly status: string;
  readonly title: string;
  readonly type: string;
}

export interface FeedbackComment {
  readonly authorLabel: string;
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly provenanceLabel: string;
}

export interface FeedbackBoard {
  readonly appearance?: { readonly voteMode: "up" | "up_down" };
  readonly board: { readonly name: string; readonly slug: string };
  readonly requests: readonly FeedbackRequest[];
}

export type VoteDirection = "up" | "down";

export interface VoteResult {
  readonly direction: VoteDirection;
  readonly downVoteCount: number;
  readonly participationVoteCount: number;
}

export interface FeedbackSubmission {
  readonly body: string;
  readonly title: string;
  readonly type: "request" | "issue";
}

/** Where the install's voter token lives: the app's own storage on Mac, the browser's on the web. */
export interface TokenStore {
  get(): string | null;
  set(token: string): void;
}

const TOKEN_KEY = "peakly.votewant.voter";

export function localTokenStore(): TokenStore {
  return {
    get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set: (token) => { try { localStorage.setItem(TOKEN_KEY, token); } catch { /* the next session registers again */ } },
  };
}

export class VoteWantError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class VoteWantFeedback {
  constructor(
    private readonly origin: string,
    private readonly board: string,
    private readonly tokens: TokenStore = localTokenStore(),
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  async getBoard(): Promise<FeedbackBoard> {
    return this.request(`/api/v1/boards/${encodeURIComponent(this.board)}`, { method: "GET" });
  }

  async myVotes(): Promise<Readonly<Record<string, VoteDirection>>> {
    const result = await this.withVoter<{ votes: Record<string, VoteDirection> }>(
      `/api/v1/boards/${encodeURIComponent(this.board)}/votes/mine`, { method: "GET" });
    return result.votes;
  }

  async vote(requestId: string, direction: VoteDirection): Promise<VoteResult> {
    return this.withVoter(`/api/v1/requests/${encodeURIComponent(requestId)}/votes`, {
      body: JSON.stringify({ direction }), method: "POST",
    });
  }

  async submit(submission: FeedbackSubmission): Promise<{ readonly id: string; readonly title: string }> {
    return this.withVoter(`/api/v1/boards/${encodeURIComponent(this.board)}/feedback`, {
      body: JSON.stringify(submission), method: "POST",
    });
  }

  async getComments(requestId: string): Promise<readonly FeedbackComment[]> {
    const result = await this.request<{ comments: FeedbackComment[] }>(
      `/api/v1/requests/${encodeURIComponent(requestId)}/comments`, { method: "GET" });
    return result.comments;
  }

  async comment(requestId: string, body: string): Promise<void> {
    await this.withVoter(`/api/v1/requests/${encodeURIComponent(requestId)}/comments`, {
      body: JSON.stringify({ body, confirmPublic: true }), method: "POST",
    });
  }

  private registering: Promise<string> | null = null;

  /** Uses this install's credential, registering one the first time. */
  private async withVoter<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.voterToken();
    return this.request(path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  }

  /** Calls made while registering share it, so one install never becomes two voters. */
  private voterToken(): Promise<string> {
    const stored = this.tokens.get();
    if (stored) return Promise.resolve(stored);
    this.registering ??= this.request<{ token: string }>("/api/v1/voters", { method: "POST" })
      .then(({ token }) => { this.tokens.set(token); return token; })
      .finally(() => { this.registering = null; });
    return this.registering;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.origin}${path}`, init).catch(() => {
      // Offline, blocked, or VoteWant down: the browser's own message ("Failed to fetch") means nothing to people.
      throw new VoteWantError(0, "VoteWant couldn't be reached. Check your connection and try again.");
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new VoteWantError(response.status, body.error ?? "VoteWant is unavailable right now.");
    return body as T;
  }
}
