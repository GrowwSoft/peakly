import { describe, expect, it, vi } from "vitest";
import { VoteWantFeedback, type TokenStore } from "@/core/votewant";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
  const store = { value: initial, get: () => store.value, set: (token: string) => { store.value = token; } };
  return store;
}

describe("VoteWant feedback client", () => {
  it("registers this install once, keeps the token, and sends it with every vote and submission", async () => {
    const tokens = memoryTokens();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ token: "vw_voter.id.secret", voterId: "id" }, 201))
      .mockResolvedValueOnce(json({ direction: "up", downVoteCount: 0, participationVoteCount: 4 }))
      .mockResolvedValueOnce(json({ id: "request_9", title: "CSV export" }, 201));
    const client = new VoteWantFeedback("https://votewant.test", "peakly-board", tokens, fetcher);

    await expect(client.vote("request_1", "up")).resolves.toMatchObject({ participationVoteCount: 4 });
    await expect(client.submit({ body: "Export the table as CSV.", title: "CSV export", type: "request" })).resolves.toMatchObject({ id: "request_9" });

    expect(tokens.value).toBe("vw_voter.id.secret");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://votewant.test/api/v1/voters", { method: "POST" });
    for (const call of [2, 3]) {
      expect(fetcher.mock.calls[call - 1]![1]).toMatchObject({ headers: { authorization: "Bearer vw_voter.id.secret" } });
    }
    expect(fetcher.mock.calls[1]![0]).toBe("https://votewant.test/api/v1/requests/request_1/votes");
    expect(fetcher.mock.calls[2]![0]).toBe("https://votewant.test/api/v1/boards/peakly-board/feedback");
  });

  it("reuses a stored token and reads the board without one", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ board: { name: "Peakly", slug: "peakly-board" }, requests: [] }))
      .mockResolvedValueOnce(json({ votes: { request_1: "down" } }));
    const client = new VoteWantFeedback("https://votewant.test", "peakly-board", memoryTokens("vw_voter.saved.secret"), fetcher);

    await expect(client.getBoard()).resolves.toMatchObject({ board: { slug: "peakly-board" } });
    await expect(client.myVotes()).resolves.toEqual({ request_1: "down" });
    expect(fetcher.mock.calls[0]![1]).toEqual({ method: "GET" });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ headers: { authorization: "Bearer vw_voter.saved.secret" } });
  });

  it("shows VoteWant's own message when it refuses", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "This board accepts upvotes only." }, 400));
    const client = new VoteWantFeedback("https://votewant.test", "peakly-board", memoryTokens("vw_voter.saved.secret"), fetcher);
    await expect(client.vote("request_1", "down")).rejects.toMatchObject({ message: "This board accepts upvotes only.", status: 400 });
  });

  it("registers once when several calls start before the first registration finishes", async () => {
    let finishRegistration: (response: Response) => void = () => {};
    const fetcher = vi.fn((url: string) => url.endsWith("/api/v1/voters")
      ? new Promise<Response>((resolve) => { finishRegistration = resolve; })
      : Promise.resolve(json({ votes: {} })));
    const tokens = memoryTokens();
    const client = new VoteWantFeedback("https://votewant.test", "peakly-board", tokens, fetcher as unknown as typeof fetch);

    const first = client.myVotes();
    const second = client.myVotes();
    finishRegistration(json({ token: "vw_voter.once.secret", voterId: "once" }, 201));
    await Promise.all([first, second]);

    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/v1/voters"))).toHaveLength(1);
    expect(tokens.value).toBe("vw_voter.once.secret");
  });

  it("explains a network failure in plain words", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new VoteWantFeedback("https://votewant.test", "peakly-board", memoryTokens("vw_voter.saved.secret"), fetcher);
    await expect(client.vote("request_1", "up")).rejects.toMatchObject({ message: "VoteWant couldn't be reached. Check your connection and try again.", status: 0 });
  });
});
