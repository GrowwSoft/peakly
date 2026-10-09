import { describe, expect, it } from "vitest";
import { feedbackBoardUrl } from "@/core/links";

describe("feedback board", () => {
  it("defaults to Peakly's VoteWant board", () => {
    expect(feedbackBoardUrl(undefined)).toBe("https://votewant.com/boards/getpeakly-com-a180b4a4?accent=2a78d6");
    expect(feedbackBoardUrl("  ")).toBe("https://votewant.com/boards/getpeakly-com-a180b4a4?accent=2a78d6");
  });

  it("uses a host's own board, and refuses IDs that aren't plain", () => {
    expect(feedbackBoardUrl("peakly-e2e-board")).toBe("https://votewant.com/boards/peakly-e2e-board?accent=2a78d6");
    expect(feedbackBoardUrl("../admin")).toBeNull();
  });
});
