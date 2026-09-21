import { explainFetchError } from "../lib/errors.ts";
import { fileWithSniffedType } from "./preprocess.ts";
import { loadSamplePhoto, SAMPLE_CARD_NAMES } from "./samplePhoto.ts";

export type SampleKind = "generated" | "photo";

export type SampleEntry = {
  id: string;
  title: string;
  blurb: string;
  filename: string;
  src?: string;
  kind: SampleKind;
  expectedNames: string[];
};

export const SAMPLE_CATALOG: SampleEntry[] = [
  {
    id: "generated",
    title: "Drawn sample",
    blurb: "Clean overlapping columns",
    filename: "sample-deck.png",
    kind: "generated",
    expectedNames: SAMPLE_CARD_NAMES,
  },
  {
    id: "overlapping-columns",
    title: "Cube on a playmat",
    blurb: "Overlapping columns, dice, mixed frames",
    filename: "overlapping-columns.jpg",
    src: "/samples/overlapping-columns.jpg",
    kind: "photo",
    expectedNames: [
      "Thran Dynamo",
      "Wildfire",
      "Icy Manipulator",
      "Burning of Xinye",
      "Shatter",
      "Mind Rot",
      "Impending Disaster",
      "Shivan Gorge",
      "Urborg Volcano",
      "Fire",
      "Mind Stone",
      "Pyrokinesis",
      "Mogg Fanatic",
      "Ravenous Rats",
      "Erg Raiders",
      "Quicksand",
      "Squee, Goblin Nabob",
      "Goblin Matron",
      "Forgotten Cave",
      "Sengir Autocrat",
      "Chimeric Staff",
      "Dauthi Mindripper",
      "Mountain",
      "Swamp",
      "Goblin Commando",
      "Sengir Vampire",
      "Gristle Grinner",
      "Battle Squadron",
      "Fire Elemental",
    ],
  },
  {
    id: "fanned-hand",
    title: "Fanned hand",
    blurb: "Six stacked title bars",
    filename: "fanned-hand.jpg",
    src: "/samples/fanned-hand.jpg",
    kind: "photo",
    expectedNames: [
      "Ogre Marauder",
      "Thopter Arrest",
      "Detonate",
      "Nylea's Emissary",
      "Sleep",
      "Triumph of Ferocity",
    ],
  },
  {
    id: "glare-angle",
    title: "Glare and angle",
    blurb: "Window light, thumb over art",
    filename: "glare-angle.jpg",
    src: "/samples/glare-angle.jpg",
    kind: "photo",
    expectedNames: [
      "Blood Cultist",
      "Strandwalker",
      "Shambling Remains",
      "Furious Reprisal",
    ],
  },
  {
    id: "close-titles",
    title: "Close titles",
    blurb: "Tight crop, gold frame",
    filename: "close-titles.jpg",
    src: "/samples/close-titles.jpg",
    kind: "photo",
    expectedNames: [
      "Sunhome Guildmage",
      "Summoner's Bane",
      "Murder of Crows",
    ],
  },
  {
    id: "boros-warriors-d6-lands",
    title: "Boros warriors · d6 lands",
    blurb: "Top-down cube, three d6 on basics",
    filename: "boros-warriors-d6-lands.jpg",
    src: "/samples/boros-warriors-d6-lands.jpg",
    kind: "photo",
    expectedNames: [
      "Archpriest of Iona",
      "Usher of the Fallen",
      "Steelshaper's Gift",
      "Claim the Firstborn",
      "Chain Lightning",
      "Luminarch Aspirant",
      "Brighthearth Banneret",
      "Grotag Bug-Catcher",
      "Flame Channeler",
      "Chief of the Edge",
      "Sunhome Guildmage",
      "Go for the Throat",
      "Terminate",
      "Ardent Electromancer",
      "Kargan Warleader",
      "Priest of Urabrask",
      "Arc Lightning",
      "Heirloom Blade",
      "Squad Commander",
      "Arashin Foremost",
      "Arid Mesa",
      "Battlefield Forge",
      "Grand Coliseum",
      "Ghitu Encampment",
      "Sulfurous Springs",
      "Plains",
      "Swamp",
      "Mountain",
    ],
  },
  {
    id: "white-aggro-d8-d12-lands",
    title: "White aggro · d8 + d12",
    blurb: "Angled d8 Plains, d12 Mountain",
    filename: "white-aggro-d8-d12-lands.png",
    src: "/samples/white-aggro-d8-d12-lands.png",
    kind: "photo",
    expectedNames: [
      "Usher of the Fallen",
      "Student of Warfare",
      "Zurgo Bellstriker",
      "Swords to Plowshares",
      "Requisition Raid",
      "Chain Lightning",
      "Unholy Heat",
      "Thalia, Guardian of Thraben",
      "Inti, Seneschal of the Sun",
      "Magda, Brazen Outlaw",
      "Earthshaker Khenra",
      "Glimmer Lens",
      "Umezawa's Jitte",
      "Adeline, Resplendent Cathar",
      "Skyclave Apparition",
      "Cosmogrand Zenith",
      "Flickerwisp",
      "Laelia, the Blade Reforged",
      "Goblin Rabblemaster",
      "Nova Hellkite",
      "Flametongue Kavu",
      "Ghostfire Slice",
      "Palace Jailer",
      "Sacred Peaks",
      "Plains",
      "Mountain",
    ],
  },
  {
    id: "jeskai-fanned-basics",
    title: "Jeskai · fanned basics",
    blurb: "Fanned Plains/Island, glare + foils",
    filename: "jeskai-fanned-basics.png",
    src: "/samples/jeskai-fanned-basics.png",
    kind: "photo",
    expectedNames: [
      "Cut Down",
      "Mana Tithe",
      "Feed the Swarm",
      "Geist of Saint Traft",
      "Bloodstained Mire",
      "Scalding Tarn",
      "Base Camp",
      "Plains",
      "Island",
      "Swamp",
    ],
  },
  {
    id: "wb-clerics-purple-mat",
    title: "W/B clerics · purple mat",
    blurb: "Angled columns, glare, nonbasic lands",
    filename: "wb-clerics-purple-mat.jpg",
    src: "/samples/wb-clerics-purple-mat.jpg",
    kind: "photo",
    expectedNames: [
      "Fetid Pools",
      "Universal Automaton",
      "Valgavoth's Faithful",
      "Stronghold Confessor",
      "Shadow-Rite Priest",
      "Malakir Blood-Priest",
      "Infernal Grasp",
      "Glass Casket",
      "Fiend Hunter",
      "Edgewalker",
      "Relic Vial",
      "Banisher Priest",
      "Drana's Emissary",
      "Vengeful Reaper",
      "Wrath of God",
      "Marsh Flats",
      "Unclaimed Territory",
      "Godless Shrine",
    ],
  },
];

export function expectedNamesForFilename(filename: string): string[] {
  return (
    SAMPLE_CATALOG.find((sample) => sample.filename === filename)
      ?.expectedNames ?? []
  );
}

export async function loadCatalogSample(id: string): Promise<File> {
  const sample = SAMPLE_CATALOG.find((entry) => entry.id === id);
  if (!sample) throw new Error("Unknown sample photo.");
  if (sample.kind === "generated") return loadSamplePhoto();
  if (!sample.src) throw new Error(`Sample ${sample.title} is missing a file.`);

  try {
    const response = await fetch(sample.src);
    if (!response.ok) {
      throw new Error(`Could not load ${sample.title} (${response.status}).`);
    }
    const blob = await response.blob();
    return fileWithSniffedType(blob, sample.filename);
  } catch (error) {
    throw explainFetchError(sample.title, error);
  }
}
