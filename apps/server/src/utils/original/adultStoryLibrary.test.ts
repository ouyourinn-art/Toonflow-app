import { describe, expect, test } from "bun:test";
import { adultStoryLibrarySnapshot, selectAdultStoryCards } from "./adultStoryLibrary";

describe("adult story structure library", () => {
  test("ranks cards against the requested theme without retaining source prose", () => {
    const selected = selectAdultStoryCards("韩国成年人出差酒店偷情倒计时", 2);
    expect(selected[0]?.id).toBe("affairCountdown");
    expect(selected.every(card => card.storyBeats.length >= 5 && card.cameraPlan.length >= 4)).toBe(true);
  });

  test("persists provenance and derived cards only", () => {
    const snapshot = adultStoryLibrarySnapshot("雨夜酒店久别重逢");
    expect(snapshot.sources.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.selected[0]?.id).toBe("secretReunion");
    expect(JSON.stringify(snapshot)).not.toContain("conversations");
  });

  test("rejects disallowed or age-ambiguous themes before prompting", () => {
    expect(() => selectAdultStoryCards("高中生校服故事")).toThrow();
    expect(() => selectAdultStoryCards("两名 30 岁成年人在酒店重逢")).not.toThrow();
  });
});
