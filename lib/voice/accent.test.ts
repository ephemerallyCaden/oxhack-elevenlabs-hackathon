import { describe, expect, it } from "vitest";
import { accentFor, withAccent } from "./accent";

const TAG = "slight British accent";

describe("withAccent", () => {
  it("adds the hint before every sentence, after existing audio tags", () => {
    expect(withAccent("[confident] Twenty-three percent. That is upside! Really?", TAG, true)).toBe(
      "[confident][slight British accent] Twenty-three percent. [slight British accent] That is upside! [slight British accent] Really?",
    );
  });

  it("keeps mid-line emotion tags and adds the hint in front of them", () => {
    expect(withAccent("Hello there. [hesitant] But maybe not.", TAG, true)).toBe(
      "[slight British accent] Hello there. [hesitant][slight British accent] But maybe not.",
    );
  });

  it("only touches the first sentence in start mode", () => {
    expect(withAccent("[calm] Order. Next topic.", TAG, false)).toBe("[calm][slight British accent] Order. Next topic.");
  });

  it("does nothing when the tag is empty or already present", () => {
    expect(withAccent("[calm] Order.", "", true)).toBe("[calm] Order.");
    expect(withAccent("[slight British accent] Order.", TAG, true)).toBe("[slight British accent] Order.");
  });
});

describe("accentFor", () => {
  it("applies to the presenter voice only, not to a judge's own clone", () => {
    expect(accentFor(undefined)).toBe(TAG);
    expect(accentFor("someJudgeCloneId")).toBe("");
  });
});
