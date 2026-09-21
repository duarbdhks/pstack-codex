import { describe, expect, test } from "bun:test";
import { componentAction, pushAction } from "../tools/sync-plan.mjs";

describe("componentAction", () => {
  test("same path tree skips", () => {
    expect(componentAction({ pinTree: "abc", headTree: "abc" })).toBe("skip");
  });

  test("different path tree syncs", () => {
    expect(componentAction({ pinTree: "abc", headTree: "def" })).toBe("sync");
  });

  test("missing head tree fails soft", () => {
    expect(componentAction({ pinTree: "abc", headTree: "" })).toBe("fail");
  });
});

describe("pushAction", () => {
  test("no remote branch pushes normally", () => {
    expect(pushAction({ openPr: false, remoteExists: false, authorNames: [] })).toBe("push");
  });

  test("bot-only orphan refreshes with a lease", () => {
    expect(
      pushAction({
        openPr: false,
        remoteExists: true,
        authorNames: ["github-actions[bot]"],
      }),
    ).toBe("force-with-lease");
  });

  test("orphan contained in main still refreshes with a lease", () => {
    expect(pushAction({ openPr: false, remoteExists: true, authorNames: [] })).toBe(
      "force-with-lease",
    );
  });

  test("human commit on an orphan reports only", () => {
    expect(
      pushAction({
        openPr: false,
        remoteExists: true,
        authorNames: ["github-actions[bot]", "duarbdhks"],
      }),
    ).toBe("report-only");
  });

  test("open bot PR refreshes with a lease", () => {
    expect(
      pushAction({
        openPr: true,
        remoteExists: true,
        authorNames: ["github-actions[bot]"],
      }),
    ).toBe("force-with-lease");
  });

  test("open PR with a human commit reports only", () => {
    expect(
      pushAction({ openPr: true, remoteExists: true, authorNames: ["duarbdhks"] }),
    ).toBe("report-only");
  });
});
