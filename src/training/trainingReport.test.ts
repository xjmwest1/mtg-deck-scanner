import { describe, expect, it } from "vitest";
import { buildTrainingReport } from "./trainingReport.ts";

const base = {
  filename: "sample.png",
  width: 1024,
  height: 768,
};

describe("buildTrainingReport", () => {
  it("groups verdicts and missed regions", () => {
    const report = buildTrainingReport({
      ...base,
      detections: [
        {
          detectedText: "Lightning Bolt",
          name: "Lightning Bolt",
          box: { x: 10, y: 20, width: 100, height: 24 },
          verdict: "correct",
        },
        {
          detectedText: "Scorching Dragonfi",
          name: "Scorching Dragonfire",
          box: { x: 5, y: 6, width: 200, height: 30 },
          verdict: "corrected",
          correctedText: "Scorching Dragonfire",
        },
        {
          detectedText: "Destroy all creatures.",
          box: { x: 1, y: 2, width: 300, height: 20 },
          verdict: "not-card",
        },
        {
          detectedText: "Opt",
          name: "Opt",
          box: { x: 0, y: 0, width: 40, height: 18 },
          verdict: "unreviewed",
        },
      ],
      added: [{ box: { x: 50, y: 60, width: 120, height: 28 }, text: "Swamp" }],
    });

    expect(report).toContain("Correct detections (1):");
    expect(report).toContain('- "Lightning Bolt" [10, 20, 100, 24]');
    expect(report).toContain("Wrong names to fix (1):");
    expect(report).toContain(
      'detected "Scorching Dragonfi" -> should be "Scorching Dragonfire" [5, 6, 200, 30]',
    );
    expect(report).toContain("False positives to suppress (1):");
    expect(report).toContain("Missed titles to detect (1):");
    expect(report).toContain('- "Swamp" [50, 60, 120, 28]');
    expect(report).toContain("Unreviewed detections (not labeled): 1");
    expect(report).not.toContain("Notes (");
  });

  it("includes notes inline with detections and added regions", () => {
    const report = buildTrainingReport({
      ...base,
      detections: [
        {
          detectedText: "Lightning Bolt",
          name: "Lightning Bolt",
          box: { x: 10, y: 20, width: 100, height: 24 },
          verdict: "correct",
          note: "glare on the title",
        },
      ],
      added: [
        {
          box: { x: 50, y: 60, width: 120, height: 28 },
          text: "Swamp",
          note: "partially covered",
        },
      ],
    });

    expect(report).toContain(
      '- "Lightning Bolt" [10, 20, 100, 24] — note: "glare on the title"',
    );
    expect(report).toContain(
      '- "Swamp" [50, 60, 120, 28] — note: "partially covered"',
    );
    expect(report).not.toContain("Notes (");
  });

  it("ignores corrected/added entries with empty text", () => {
    const report = buildTrainingReport({
      ...base,
      detections: [
        {
          detectedText: "Foo",
          box: { x: 0, y: 0, width: 10, height: 10 },
          verdict: "corrected",
          correctedText: "   ",
        },
      ],
      added: [{ box: { x: 0, y: 0, width: 10, height: 10 }, text: "  " }],
    });
    expect(report).toContain("Wrong names to fix (0):");
    expect(report).toContain("Missed titles to detect (0):");
  });
});
