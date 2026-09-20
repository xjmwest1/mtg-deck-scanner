import { describe, expect, it } from "vitest";
import { suppressOverlapping } from "./scan.ts";
import type { CardDetection, Rect } from "../models/detection.ts";

function detection(
  name: string,
  box: Rect,
  confidence = 0.8,
  detectedText = name,
): CardDetection {
  return {
    id: `${detectedText}-${box.x}-${box.y}`,
    name,
    detectedText,
    confidence,
    polygon: [],
    boundingBox: box,
    matches: [{ name, score: confidence }],
    status: "confirmed",
    source: "ocr",
  };
}

describe("suppressOverlapping", () => {
  it("drops a smaller same-name re-read stacked under the real title", () => {
    const title = detection("Grand Coliseum", { x: 283, y: 536, width: 67, height: 33 }, 0.7);
    const reread = detection("Grand Coliseum", { x: 284, y: 669, width: 63, height: 13 }, 0.9);
    const other = detection("Sunhome Guildmage", { x: 213, y: 305, width: 88, height: 17 });

    const { kept, suppressed } = suppressOverlapping([title, reread, other], 520);
    const keptIds = kept.map((d) => d.id);

    expect(keptIds).toContain(title.id);
    expect(keptIds).toContain(other.id);
    expect(keptIds).not.toContain(reread.id);
    expect(suppressed.map((d) => d.id)).toContain(reread.id);
  });

  it("keeps two genuine same-name copies printed at the same scale", () => {
    const first = detection("Lightning Bolt", { x: 100, y: 40, width: 80, height: 20 });
    const second = detection("Lightning Bolt", { x: 102, y: 120, width: 78, height: 19 });

    const { kept } = suppressOverlapping([first, second]);
    expect(kept).toHaveLength(2);
  });

  it("keeps stacked overlapping titles and drops body-text names under them", () => {
    const luminarch = detection("Luminarch Aspirant", { x: 216, y: 4, width: 78, height: 16 });
    const grotag = detection("Grotag Bug-Catcher", { x: 221, y: 113, width: 25, height: 10 }, 0.7, "Grotag");
    const gornog = detection("Gornog, the Red Reaper", { x: 520, y: 120, width: 93, height: 21 });
    const flame = detection("Flame Channeler", { x: 230, y: 181, width: 61, height: 13 });
    const heirloom = detection("Heirloom Blade", { x: 686, y: 196, width: 61, height: 18 });
    const chainLightning = detection("Chain Lightning", { x: 28, y: 248, width: 72, height: 16 });
    const sunhome = detection("Sunhome Guildmage", { x: 213, y: 305, width: 82, height: 17 });
    const terminate = detection("Terminate", { x: 376, y: 292, width: 44, height: 14 });
    const coliseum = detection("Grand Coliseum", { x: 283, y: 536, width: 67, height: 33 });
    const ghitu = detection("Ghitu Encampment", { x: 366, y: 536, width: 84, height: 33 });
    const sulfurous = detection("Sulfurous Springs", { x: 218, y: 540, width: 59, height: 25 });
    const forge = detection("Battlefield Forge", { x: 137, y: 540, width: 65, height: 19 }, 0.7, "Batrkfe Forgs");
    const swamp = detection("Swamp", { x: 696, y: 539, width: 37, height: 23 });
    const mountain = detection("Mountain", { x: 861, y: 530, width: 41, height: 19 });

    const chainDevil = detection("Chain Devil", { x: 35, y: 381, width: 43, height: 10 });
    const regenerate = detection("Regenerate", { x: 376, y: 412, width: 42, height: 11 });
    const buoyancy = detection("Buoyancy", { x: 689, y: 355, width: 25, height: 10 });
    const grandMelee = detection("Grand Melee", { x: 284, y: 669, width: 63, height: 13 });
    const forgeRules = detection("Battlefield Forge", { x: 128, y: 700, width: 63, height: 16 });
    const atog = detection("Atogatog", { x: 207, y: 689, width: 53, height: 15 });

    const { kept } = suppressOverlapping(
      [
        luminarch,
        grotag,
        gornog,
        flame,
        heirloom,
        chainLightning,
        sunhome,
        terminate,
        coliseum,
        ghitu,
        sulfurous,
        forge,
        swamp,
        mountain,
        chainDevil,
        regenerate,
        buoyancy,
        grandMelee,
        forgeRules,
        atog,
      ],
      520,
    );
    const texts = kept.map((item) => item.detectedText);

    expect(texts).toContain("Grotag");
    expect(texts).toContain("Luminarch Aspirant");
    expect(texts).toContain("Flame Channeler");
    expect(texts).toContain("Sunhome Guildmage");
    expect(texts).toContain("Terminate");
    expect(texts).toContain("Batrkfe Forgs");
    expect(texts).toContain("Swamp");
    expect(texts).not.toContain("Chain Devil");
    expect(texts).not.toContain("Regenerate");
    expect(texts).not.toContain("Buoyancy");
    expect(texts).not.toContain("Grand Melee");
    expect(texts).not.toContain("Atogatog");
    expect(kept.filter((item) => item.name === "Battlefield Forge")).toHaveLength(1);
  });

  it("keeps overlapping white-aggro titles and drops rules/flavor matches", () => {
    const titles = [
      detection("Usher of the Fallen", { x: 165, y: 18, width: 72, height: 16 }),
      detection("Mother of Runes", { x: 178, y: 55, width: 61, height: 20 }, 0.7, "mother of runes"),
      detection("Student of Warfare", { x: 157, y: 129, width: 80, height: 18 }, 0.7, "student of warfare"),
      detection("Requisition Raid", { x: 125, y: 349, width: 71, height: 22 }, 0.7, "requisition raid"),
      detection("Unholy Heat", { x: 110, y: 500, width: 70, height: 16 }),
      detection("Thalia, Guardian of Thraben", { x: 316, y: 25, width: 101, height: 21 }),
      detection("Inti, Seneschal of the Sun", { x: 325, y: 69, width: 69, height: 15 }, 0.7, "l. Senee hal ef the"),
      detection("Earthshaker Khenra", { x: 313, y: 194, width: 81, height: 20 }, 0.7, "earthshaker khenra"),
      detection("Umezawa's Jitte", { x: 305, y: 318, width: 80, height: 16 }),
      detection("Adeline, Resplendent Cathar", { x: 463, y: 34, width: 91, height: 16 }),
      detection("Cosmogrand Zenith", { x: 471, y: 128, width: 85, height: 19 }, 0.7, "cosmogrand zenith"),
      detection("Flickerwisp", { x: 480, y: 191, width: 37, height: 13 }, 0.7, "Fickerwine"),
      detection("Laelia, the Blade Reforged", { x: 612, y: 41, width: 41, height: 13 }, 0.7, "Laetle he m"),
      detection("Goblin Rabblemaster", { x: 624, y: 81, width: 70, height: 15 }, 0.7, "goblin rabblemaster"),
      detection("Nova Hellkite", { x: 627, y: 142, width: 48, height: 17 }, 0.7, "nova hellkite"),
      detection("Flametongue Kavu", { x: 631, y: 175, width: 64, height: 15 }, 0.7, "flametongue kavu"),
      detection("Ghostfire Slice", { x: 628, y: 228, width: 69, height: 16 }, 0.7, "ghostfire slice"),
      detection("Sacred Peaks", { x: 280, y: 538, width: 70, height: 20 }),
      detection("Plains", { x: 470, y: 545, width: 50, height: 20 }),
      detection("Mountain", { x: 644, y: 547, width: 44, height: 21 }),
      detection("Palace Jailer", { x: 780, y: 22, width: 82, height: 18 }),
    ];
    const token = detection("Treasure", { x: 46, y: 14, width: 34, height: 12 }, 0.8, "TUEASURI");
    const falsePositives = [
      detection("Crater Elemental", { x: 479, y: 286, width: 59, height: 9 }),
      detection("Dire Tactics", { x: 300, y: 423, width: 61, height: 9 }),
      detection("more card types am c", { x: 111, y: 607, width: 86, height: 12 }, 0.6, "more card types am c"),
      detection("Runecarved Obelisk", { x: 111, y: 614, width: 35, height: 12 }),
      detection("Melt Terrain", { x: 480, y: 312, width: 44, height: 8 }),
      detection("Ensnare", { x: 113, y: 564, width: 25, height: 9 }),
      detection("Cruel Edict", { x: 382, y: 469, width: 35, height: 10 }),
      detection("Cao Cao, Lord of Wei", { x: 297, y: 688, width: 63, height: 14 }),
      detection("s tri dd ha a", { x: 477, y: 336, width: 82, height: 13 }, 0.5, "s tri dd ha a"),
      detection("Jue Cho eIaed catare", { x: 296, y: 461, width: 104, height: 13 }, 0.55, "Jue Cho eIaed catare"),
      detection("Three Tree Scribe", { x: 353, y: 439, width: 54, height: 9 }),
      detection("nfhce this artface Ald one", { x: 0, y: 137, width: 89, height: 16 }, 0.5, "nfhce this artface Ald one"),
      detection("e n che floanng", { x: 359, y: 719, width: 54, height: 15 }, 0.5, "e n che floanng"),
      detection("ftes", { x: 481, y: 348, width: 36, height: 9 }, 0.5, "ftes"),
    ];

    const { kept } = suppressOverlapping([...titles, token, ...falsePositives], 522);
    const texts = kept.map((item) => item.detectedText);
    const names = kept.map((item) => item.name);

    expect(names).toContain("Flickerwisp");
    expect(names).toContain("Inti, Seneschal of the Sun");
    expect(names).toContain("Laelia, the Blade Reforged");
    expect(names).toContain("Student of Warfare");
    expect(names).toContain("Thalia, Guardian of Thraben");
    expect(names).toContain("Goblin Rabblemaster");
    expect(names).toContain("Mountain");
    expect(names).not.toContain("Treasure");
    expect(texts).not.toContain("TUEASURI");
    expect(names).not.toContain("Crater Elemental");
    expect(names).not.toContain("Dire Tactics");
    expect(names).not.toContain("Ensnare");
    expect(names).not.toContain("Cruel Edict");
    expect(names).not.toContain("Cao Cao, Lord of Wei");
    expect(names).not.toContain("Three Tree Scribe");
    expect(names).not.toContain("Melt Terrain");
    expect(names).not.toContain("Runecarved Obelisk");
    expect(texts).not.toContain("more card types am c");
    expect(texts).not.toContain("s tri dd ha a");
    expect(texts).not.toContain("nfhce this artface Ald one");
    expect(texts).not.toContain("e n che floanng");
    expect(texts).not.toContain("ftes");
    expect(texts).not.toContain("Jue Cho eIaed catare");
  });
});
