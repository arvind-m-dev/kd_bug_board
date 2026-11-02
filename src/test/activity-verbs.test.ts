import { describe, expect, it } from "vitest";
import { changeVerb } from "@/lib/activity";

describe("changeVerb", () => {
  it("names bug, file, sprint and backlog changes in plain words", () => {
    expect(changeVerb("bug.status")).toBe("changed the status");
    expect(changeVerb("bug.media_purged")).toBe("deleted a file forever");
    expect(changeVerb("sprint.item_added")).toBe("added it to a sprint");
    expect(changeVerb("backlog.ranked")).toBe("re-ranked the item");
  });
  it("never shows a raw action name for an unknown action", () => {
    expect(changeVerb("sprint.item_moved")).toBe("item moved");
    expect(changeVerb("bug.new_thing")).toBe("new thing");
  });
});
