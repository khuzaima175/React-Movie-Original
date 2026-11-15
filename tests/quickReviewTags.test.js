import test from "node:test";
import assert from "node:assert/strict";
import {
    QUICK_REVIEW_TAGS,
    getContextualQuickTags,
    hasQuickTagInNote,
    toggleQuickTagInNote
} from "../src/services/quickReviewTags.js";

test("QUICK_REVIEW_TAGS preserves existing positive keys and adds constructive critique tags", () => {
    const ids = QUICK_REVIEW_TAGS.map((t) => t.id);
    assert.ok(ids.includes("Masterpiece"));
    assert.ok(ids.includes("MindBlowing"));
    assert.ok(ids.includes("GreatActing"));
    assert.ok(ids.includes("Cinematography"));
    assert.ok(ids.includes("EpicScore"));
    assert.ok(ids.includes("PlotTwist"));
    assert.ok(ids.includes("MustRewatch"));
    assert.ok(ids.includes("Emotional"));
    assert.ok(ids.includes("CultClassic"));
    assert.ok(ids.includes("Iconic"));
    assert.ok(ids.includes("SlowPacing"));
    assert.ok(ids.includes("WeakEnding"));
    assert.ok(ids.includes("TooBleak"));
});

test("toggleQuickTagInNote formats hashtags cleanly, toggles off without orphan spaces, and enforces maxLength", () => {
    const added = toggleQuickTagInNote("Great twist", "SmartPlot", 200);
    assert.equal(added, "Great twist #SmartPlot");
    const removed = toggleQuickTagInNote(added, "#SmartPlot", 200);
    assert.equal(removed, "Great twist");

    const fromStart = toggleQuickTagInNote("#SmartPlot Great twist", "SmartPlot", 200);
    assert.equal(fromStart, "Great twist");

    const partialNoClobber = toggleQuickTagInNote("#MasterpieceTwo great", "Masterpiece", 200);
    assert.equal(partialNoClobber, "#MasterpieceTwo great #Masterpiece");

    const nearLimit = "x".repeat(195);
    assert.equal(toggleQuickTagInNote(nearLimit, "Masterpiece", 200), nearLimit, "Does not overflow maxLength");
    assert.equal(hasQuickTagInNote("#MasterpieceTwo", "Masterpiece"), false);
    assert.equal(hasQuickTagInNote("#MasterpieceTwo #Masterpiece", "Masterpiece"), true);

    const lowRatedTags = getContextualQuickTags(5).map((t) => t.id);
    assert.ok(lowRatedTags.includes("SlowPacing") && lowRatedTags.includes("WeakEnding") && lowRatedTags.includes("TooBleak"));

    const highRatedTags = getContextualQuickTags(9).map((t) => t.id);
    assert.ok(highRatedTags.includes("Masterpiece") && highRatedTags.includes("SmartPlot"));
});
