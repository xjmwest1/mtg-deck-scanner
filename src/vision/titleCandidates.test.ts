import { describe, expect, it } from "vitest";
import {
  mergeLineFragments,
  selectTitleCandidates,
  titleFilterReason,
} from "./titleCandidates.ts";
import type { OCRRegion } from "../models/detection.ts";

type Labeled = [text: string, x: number, y: number, width: number, height: number];

function region(text: string, x: number, y: number, width: number, height: number): OCRRegion {
  return {
    text,
    confidence: 0.9,
    polygon: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    boundingBox: { x, y, width, height },
  };
}

function toRegion([text, x, y, width, height]: Labeled): OCRRegion {
  return region(text, x, y, width, height);
}

// Existing detections whose names were wrong, plus missed titles. All of these
// must survive the candidate filter so they can be matched or corrected.
const GROUND_TRUTH_TITLES: Labeled[] = [
  ["Grotag", 221, 113, 25, 10],
  ["Sacred Foi", 79, 543, 42, 13],
  ["white Mage's Sraf", 374, 52, 62, 12],
  ["Batrkfe Forgs", 137, 540, 65, 19],
  ["sevbhu", 60, 118, 29, 12],
  ["archpriest of iona", 69, 4, 74, 18],
  ["luminarch aspirant", 216, 4, 78, 16],
  ["flame channeler", 230, 181, 61, 13],
  ["chief of the edge", 217, 245, 69, 16],
  ["sunhome guildmage", 213, 305, 82, 17],
  ["terminate", 376, 292, 44, 14],
  ["gornog, the red reaper", 520, 120, 93, 21],
  ["ardent electromancer", 519, 198, 85, 14],
  ["kargan warleader", 532, 306, 77, 18],
  ["heirloom blade", 686, 196, 61, 18],
  ["squad commander", 803, 15, 68, 13],
  ["swamp", 696, 539, 37, 23],
  ["mountain", 861, 530, 41, 19],
];

const WHITE_AGGRO_TITLES: Labeled[] = [
  ["l. Senee hal ef the", 325, 69, 69, 15],
  ["Fickerwine", 480, 191, 37, 13],
  ["Laetle he m", 612, 41, 41, 13],
  ["mother of runes", 178, 55, 61, 20],
  ["student of warfare", 157, 129, 80, 18],
  ["requisition raid", 125, 349, 71, 22],
  ["earthshaker khenra", 313, 194, 81, 20],
  ["Thalia, Guardian of Thraben", 316, 25, 101, 21],
  ["Adeline, Resplendent Cathar", 463, 34, 91, 16],
  ["cosmogrand zenith", 471, 128, 85, 19],
  ["ghostfire slice", 628, 228, 69, 16],
  ["flametongue kavu", 631, 175, 64, 15],
  ["nova hellkite", 627, 142, 48, 17],
  ["goblin rabblemaster", 624, 81, 70, 15],
  ["mountain", 644, 547, 44, 21],
];

const STRUCTURAL_FALSE_POSITIVES: Labeled[] = [
  ["sor that copy", 33, 418, 45, 10],
  ["@:Add one color", 132, 675, 63, 13],
  ["banlefield tapped.", 363, 686, 68, 14],
  ["Crcature Hhuman Wirard", 211, 409, 82, 11],
  ["deals I danage tu", 281, 714, 66, 14],
  ["P: Add 1 Bo yuue", 283, 687, 64, 14],
  ["P,Pay I life", 12, 681, 41, 12],
  ["Borderland Behemoth", 72, 656, 30, 13],
  ["Lapped.", 284, 678, 29, 12],
  ["to you.", 129, 713, 28, 10],
  ["oA2", 75, 675, 32, 12],
  ["AaO", 210, 682, 38, 10],
];

const WHITE_AGGRO_STRUCTURAL_FALSE_POSITIVES: Labeled[] = [
  ["more card types am c", 111, 607, 86, 12],
  ["nfhce this artface Ald one", 0, 137, 89, 16],
  ["s tri dd ha a", 477, 336, 82, 13],
  ["ftes", 481, 348, 36, 9],
  ["Bae Chtoo cheFaguped ccatete", 295, 460, 117, 13],
  ["AuAd", 58, 142, 19, 10],
  ["Eeup", 293, 479, 28, 13],
];

// Real card names OCR'd from type lines / rules / collector text. Geometry
// looks like a title, so the candidate filter must leave them for column
// body suppression rather than dropping equally-short real titles.
const TITLE_SHAPED_FALSE_POSITIVES: Labeled[] = [
  ["Grand Melee", 284, 669, 63, 13],
  ["Atogatog", 207, 689, 53, 15],
  ["mi, henerher af Ealan", 393, 451, 64, 10],
  ["Chain Devil", 35, 381, 43, 10],
  ["ento tbe bastileeld", 208, 461, 73, 11],
  ["Waste Land", 541, 659, 25, 10],
  ["Battlefield Forge", 128, 700, 63, 16],
  ["Regenerate", 376, 412, 42, 11],
  ["Buoyancy", 689, 355, 25, 10],
  ["cntinr", 385, 429, 34, 19],
];

const WHITE_AGGRO_TITLE_SHAPED_FALSE_POSITIVES: Labeled[] = [
  ["Crater Elemental", 479, 286, 59, 9],
  ["Dire Tactics", 300, 423, 61, 9],
  ["Ensnare", 113, 564, 25, 9],
  ["Cruel Edict", 382, 469, 35, 10],
  ["Cao Cao, Lord of Wei", 297, 688, 63, 14],
  ["Three Tree Scribe", 353, 439, 54, 9],
  ["Melt Terrain", 480, 312, 44, 8],
  ["Runecarved Obelisk", 111, 614, 35, 12],
  ["Jue Cho eIaed catare", 296, 461, 104, 13],
  ["e n che floanng", 359, 719, 54, 15],
  ["Buried Treasure", 32, 120, 27, 10],
  ["Creature-Flemena", 479, 286, 59, 9],
];

describe("mergeLineFragments", () => {
  it("joins split words from the same title bar", () => {
    const merged = mergeLineFragments([
      region("Steam", 100, 40, 70, 20),
      region("Vents", 176, 41, 68, 19),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("Steam Vents");
  });

  it("keeps stacked titles in a column separate", () => {
    const merged = mergeLineFragments([
      region("Shock", 100, 40, 80, 20),
      region("Mountain", 100, 90, 90, 20),
    ]);
    expect(merged.map((item) => item.text)).toEqual(["Shock", "Mountain"]);
  });

  it("does not fuse a packed row of distinct land titles", () => {
    const landRow = [
      region("arid mesa", 12, 539, 47, 34),
      region("Sacred Foi", 79, 543, 42, 13),
      region("Batrkfe Forgs", 137, 540, 65, 19),
      region("swamp", 696, 539, 37, 23),
      region("mountain", 861, 530, 41, 19),
    ];
    const merged = mergeLineFragments(landRow);
    expect(merged).toHaveLength(landRow.length);
  });
});

describe("titleFilterReason", () => {
  it("accepts every labeled title and truncated OCR name", () => {
    const rejected = [...GROUND_TRUTH_TITLES, ...WHITE_AGGRO_TITLES]
      .filter((entry) => titleFilterReason(toRegion(entry)) !== null)
      .map((entry) => `${entry[0]}: ${titleFilterReason(toRegion(entry))}`);
    expect(rejected).toEqual([]);
  });

  it("rejects rules, type-line, and collector fragments", () => {
    const accepted = [...STRUCTURAL_FALSE_POSITIVES, ...WHITE_AGGRO_STRUCTURAL_FALSE_POSITIVES]
      .filter((entry) => titleFilterReason(toRegion(entry)) === null)
      .map(([text]) => text);
    expect(accepted).toEqual([]);
  });
});

describe("selectTitleCandidates", () => {
  it("keeps labeled titles while dropping structural false positives", () => {
    const mixed = [
      ...GROUND_TRUTH_TITLES,
      ...STRUCTURAL_FALSE_POSITIVES,
      ...TITLE_SHAPED_FALSE_POSITIVES,
    ].map(toRegion);
    const candidates = selectTitleCandidates(mixed);
    const texts = candidates.map((item) => item.text);
    for (const [text] of GROUND_TRUTH_TITLES) {
      expect(texts).toContain(text);
    }
    for (const [text] of STRUCTURAL_FALSE_POSITIVES) {
      expect(texts).not.toContain(text);
    }
  });

  it("keeps white-aggro titles while dropping structural false positives", () => {
    const mixed = [
      ...WHITE_AGGRO_TITLES,
      ...WHITE_AGGRO_STRUCTURAL_FALSE_POSITIVES,
      ...WHITE_AGGRO_TITLE_SHAPED_FALSE_POSITIVES,
    ].map(toRegion);
    const candidates = selectTitleCandidates(mixed);
    const texts = candidates.map((item) => item.text);
    for (const [text] of WHITE_AGGRO_TITLES) {
      expect(texts).toContain(text);
    }
    for (const [text] of WHITE_AGGRO_STRUCTURAL_FALSE_POSITIVES) {
      expect(texts).not.toContain(text);
    }
  });
});

