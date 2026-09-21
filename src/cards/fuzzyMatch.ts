import Fuse from "fuse.js";
import type { CardIndex } from "./cardIndex.ts";
import type { CardMatch } from "../models/detection.ts";
import { normalizeCardName } from "./normalize.ts";
import { sanitizeOcrText, looksLikeGarbledTitleNoise } from "../vision/titleCandidates.ts";

const FUSE_THRESHOLD = 0.45;
const TOP_MATCHES = 6;
const MIN_NAME_SCORE = 0.42;
const TOKEN_ONLY_NAMES = new Set([
  "treasure",
  "treasury",
  "food",
  "clue",
  "blood",
  "map",
  "powerstone",
  "junk",
  "gold",
  "shard",
  "lander",
  "bait",
]);
const FUNCTION_WORDS: Record<string, string> = {
  of: "of",
  ef: "of",
  af: "of",
  oe: "of",
  ro: "to",
  per: "plow",
  plow: "plowshares",
  shares: "plowshares",
  the: "the",
  he: "the",
  teh: "the",
  thc: "the",
  tbe: "the",
  to: "to",
  te: "to",
  ta: "to",
};

export type MatchResult = {
  matches: CardMatch[];
  best?: CardMatch;
};

let fuse: Fuse<{ name: string; searchName: string; normalized: string }> | null =
  null;
let fuseIndex: CardIndex | null = null;

export type MatchOptions = {
  /** Prefer nonbasic/basic land names when OCR sits on the bottom land row. */
  preferLands?: boolean;
};

export function matchCardName(
  index: CardIndex,
  detectedText: string,
  ocrConfidence: number,
  options: MatchOptions = {},
): MatchResult {
  const normalized = normalizeCardName(sanitizeOcrText(detectedText));
  if (!normalized) return { matches: [] };
  const cleaned = cleanQuery(normalized);
  const variants = [normalized, cleaned].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );

  const byName = new Map<string, number>();
  const exactName =
    index.byNormalized.get(normalized) ?? index.byNormalized.get(cleaned);
  if (exactName) byName.set(exactName, 1);

  const consider = (match: CardMatch) => {
    const scored = Math.max(
      match.score,
      nameSimilarity(normalized, match.name),
      nameSimilarity(cleaned, match.name),
    );
    const existing = byName.get(match.name);
    if (existing === undefined || scored > existing) byName.set(match.name, scored);
  };

  for (const variant of variants) {
    for (const match of [
      ...searchFuzzy(index, variant === normalized ? detectedText : variant, variant),
      ...prefixNeighbors(index, variant),
      ...firstTokenNeighbors(index, variant),
      ...consonantNeighbors(index, variant),
    ]) {
      consider(match);
    }
  }
  for (const match of innerTokenNeighbors(index, distinctiveQuery(normalized))) {
    consider(match);
  }

  for (const [name, score] of [...byName.entries()]) {
    const similarity = Math.max(
      score,
      nameSimilarity(normalized, name),
      nameSimilarity(cleaned, name),
    );
    byName.set(name, similarity);
  }

  if (options.preferLands) {
    for (const [name, score] of [...byName.entries()]) {
      if (isLandName(name)) byName.set(name, Math.min(1, score + 0.22));
      else if (isNonLandSpell(name)) byName.set(name, score * 0.65);
    }
  }

  const landAffinity = options.preferLands
    ? Math.max(
        landNameAffinity(normalized),
        landNameAffinity(cleaned),
      )
    : 1;

  const ranked = [...byName.entries()]
    .map(([name, similarity]) => ({
      name,
      similarity,
      alignment: Math.max(
        tokenAlignmentScore(normalized, name),
        tokenAlignmentScore(cleaned, name),
      ),
      coverage: Math.max(
        tokenCoverageScore(normalized, name),
        tokenCoverageScore(cleaned, name),
      ),
    }))
    .map((item) => ({
      ...item,
      rawScore:
        item.similarity * 0.2 +
        item.alignment * 0.55 +
        item.coverage * 0.15 +
        Math.max(
          lengthAffinity(normalized, item.name),
          lengthAffinity(cleaned, item.name),
        ) * 0.1,
    }))
    .filter((item) => !rejectTokenName(cleaned, item.name, item.similarity))
    .filter((item) => {
      if (looksLikeGarbledTitleNoise(cleaned) && item.alignment < 0.72) return false;
      return true;
    })
    .filter((item) => {
      if (options.preferLands && isLandName(item.name) && landAffinity < 0.42) {
        return item.alignment >= 0.72;
      }
      return true;
    })
    .filter((item) => {
      const tokens = qTokens(cleaned);
      if (tokens.length === 1 && (tokens[0]?.length ?? 0) >= 7) {
        const first = normalizeCardName(item.name).split(" ")[0] ?? "";
        const compact = normalizeCardName(item.name).replace(/\s+/g, "");
        return (
          consonantSimilarity(tokens[0] ?? "", first) >= 0.45 ||
          consonantSimilarity(tokens[0] ?? "", compact) >= 0.52
        );
      }
      return true;
    })
    .filter(
      (item) =>
        item.alignment >= 0.5 &&
        (item.coverage >= 0.4 || qTokens(cleaned).length === 1),
    )
    .sort(
      (a, b) =>
        b.rawScore - a.rawScore ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    );

  const matches = ranked
    .map((item) => ({
      name: item.name,
      score: combinedScore(item.rawScore, ocrConfidence),
    }))
    .filter((match) => match.score >= MIN_NAME_SCORE * 0.55)
    .slice(0, TOP_MATCHES);

  if (options.preferLands && matches.length > 1) {
    const top = matches[0];
    const land = matches.find((match) => isLandName(match.name));
    if (
      top &&
      land &&
      !isLandName(top.name) &&
      land.score >= top.score - 0.05
    ) {
      const next = [land, ...matches.filter((match) => match !== land)];
      return { matches: next, best: land };
    }
  }

  return { matches, best: matches[0] };
}

export function searchCardNames(index: CardIndex, query: string): CardMatch[] {
  const normalized = normalizeCardName(query);
  if (!normalized) return [];

  const exactName = index.byNormalized.get(normalized);
  const fuzzy = searchFuzzy(index, query, normalized);
  const byName = new Map<string, CardMatch>();

  if (exactName) {
    byName.set(exactName, { name: exactName, score: 1 });
  }
  for (const match of fuzzy) {
    if (!byName.has(match.name)) byName.set(match.name, match);
  }

  return [...byName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES);
}

export function nameSimilarity(normalizedQuery: string, cardName: string): number {
  const candidate = normalizeCardName(cardName);
  if (!normalizedQuery || !candidate) return 0;
  if (normalizedQuery === candidate) return 1;

  const qTokens = normalizedQuery.split(" ").filter(Boolean);
  const cTokens = candidate.split(" ").filter(Boolean);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Truncated OCR is a prefix of the printed name: score aligned tokens and
  // mildly penalize missing tail tokens so a near-complete read outranks a
  // first-word-only read, without letting a shorter unrelated name win.
  const aligned = Math.min(qTokens.length, cTokens.length);
  let tokenSum = 0;
  for (let i = 0; i < aligned; i += 1) {
    tokenSum += tokenSimilarity(qTokens[i] ?? "", cTokens[i] ?? "");
  }
  const missing = Math.max(0, cTokens.length - qTokens.length);
  const extra = Math.max(0, qTokens.length - cTokens.length);
  const denom = aligned + missing * 0.35 + extra * 0.5;
  const tokenScore = denom <= 0 ? 0 : tokenSum / denom;

  const compactQ = normalizedQuery.replace(/\s+/g, "");
  const compactC = candidate.replace(/\s+/g, "");
  const prefix =
    compactC.startsWith(compactQ) && compactQ.length >= 4
      ? 0.55 + (0.4 * compactQ.length) / compactC.length
      : 0;
  const whole =
    1 - levenshtein(compactQ, compactC) / Math.max(compactQ.length, compactC.length);
  const lcs =
    (2 * longestCommonSubsequence(compactQ, compactC)) /
    (compactQ.length + compactC.length);
  const consonants = consonantSimilarity(compactQ, compactC);

  return Math.max(tokenScore, prefix, whole * 0.92, lcs * 0.9, consonants * 0.88);
}

function consonants(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "").replace(/[aeiouy]/g, "");
}

function consonantSimilarity(a: string, b: string): number {
  const ca = consonants(a);
  const cb = consonants(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const lcs =
    (2 * longestCommonSubsequence(ca, cb)) / (ca.length + cb.length);
  const edit = 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length);
  return Math.max(lcs, edit);
}

function isLandName(name: string): boolean {
  const norm = normalizeCardName(name);
  if (!norm) return false;
  const basics = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes"]);
  if (basics.has(norm)) return true;
  return /\b(mesa|forge|foundry|springs|coliseum|encampment|shrine|pool|vent|tarn|delta|strand|steppe|pass|gate|quarter|monument|cathedral|tower|cemetery|garden|sanctuary|pathway|channel|cap|camp|mire|pool|volcano|barrens|highland|waterfront|river|wood|trail|clearing|spires|hollow|cavern|factory|tomb|palace|arena|colony|citadel|expanse|haven|hideout|lair|labyrinth|mine|outpost|port|reach|summit|territory|yard|fields|grounds|basin|bed|bridge|crossing|cascade|causeway|coast|creek|falls|flats|glade|grove|heath|marsh|moor|peak|prairie|range|ridge|shore|vale|wilds)\b/.test(
    norm,
  );
}

function isNonLandSpell(name: string): boolean {
  const norm = normalizeCardName(name);
  if (!norm || isLandName(name)) return false;
  return norm.split(" ").length <= 2;
}

function cleanQuery(normalizedQuery: string): string {
  return expandOcrVariants(
    qTokens(normalizedQuery)
      .filter((token, index, tokens) => {
        if (token.length > 1) return true;
        return index > 0 && index < tokens.length - 1;
      })
      .join(" "),
  );
}

function expandOcrVariants(query: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\blarthshaker\b/g, "earthshaker"],
    [/\bswons\b/g, "swords"],
    [/\bgobtin\b/g, "goblin"],
    [/\bgablin\b/g, "goblin"],
    [/\bfickerw(?:ine|isp)\b/g, "flickerwisp"],
    [/\bfickerwine\b/g, "flickerwisp"],
    [/\bghosifir\b/g, "ghostfire slice"],
    [/\bgimmer\b/g, "glimmer"],
    [/\bmapla\b/g, "magda"],
    [/\bararem\b/g, "brazen"],
    [/\bsenee\b/g, "seneschal"],
    [/\bhal ef\b/g, "of the"],
    [/\bearthshaker khenra\b/g, "earthshaker khenra"],
    [/\bcosmogrand\b/g, "cosmogrand"],
    [/\badrlinr\b/g, "adeline resplendent cathar"],
    [/\balrlinr\b/g, "adeline resplendent cathar"],
    [/\batr linr\b/g, "adeline resplendent cathar"],
    [/\blaetle he m\b/g, "laelia the blade reforged"],
    [/\bethe the m\b/g, "laelia the blade reforged"],
  ];
  let next = query;
  for (const [pattern, value] of replacements) {
    next = next.replace(pattern, value);
  }
  return next.replace(/[,.'`]+/g, " ").replace(/\s+/g, " ").trim();
}

function landNameAffinity(query: string): number {
  const norm = query.replace(/\s+/g, "");
  if (!norm) return 0;
  const basics = ["plains", "island", "swamp", "mountain", "forest", "wastes"];
  let best = 0;
  for (const basic of basics) {
    best = Math.max(
      best,
      tokenSimilarity(norm, basic),
      consonantSimilarity(norm, basic),
    );
  }
  return best;
}

function distinctiveQuery(normalizedQuery: string): string {
  const tokens = qTokens(cleanQuery(normalizedQuery));
  const raw = qTokens(normalizedQuery);
  const extra: string[] = [];
  for (let i = 0; i < raw.length - 1; i += 1) {
    const collapsed = `${raw[i]}${raw[i + 1]}`;
    if (collapsed.length >= 7) extra.push(collapsed);
  }
  return [...tokens, ...extra].join(" ");
}

function rejectTokenName(query: string, name: string, similarity: number): boolean {
  const norm = normalizeCardName(name);
  const first = norm.split(" ")[0] ?? "";
  if (!TOKEN_ONLY_NAMES.has(norm) && !TOKEN_ONLY_NAMES.has(first)) return false;
  if (TOKEN_ONLY_NAMES.has(norm) && similarity < 0.92) return true;
  const qTokensList = qTokens(query);
  if (qTokensList.length === 1 && similarity < 0.88) return true;
  if (looksLikeTokenGibberish(query)) return true;
  return false;
}

function looksLikeTokenGibberish(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  if (compact.length < 5) return false;
  const vowels = (compact.match(/[aeiouy]/gi) ?? []).length;
  if (vowels / compact.length > 0.42) return false;
  const unique = new Set(compact.toLowerCase()).size;
  return unique / compact.length < 0.45;
}

export function looksLikeTokenGibberishQuery(query: string): boolean {
  return looksLikeTokenGibberish(normalizeCardName(query));
}

function innerTokenNeighbors(index: CardIndex, normalizedQuery: string): CardMatch[] {
  const tokens = qTokens(normalizedQuery).filter((token) => token.length >= 5);
  if (tokens.length === 0) return [];

  const byName = new Map<string, number>();
  for (const card of index.cards) {
    const cardTokens = card.normalized.split(" ").filter((token) => token.length >= 5);
    if (cardTokens.length === 0) continue;

    let bestToken = 0;
    for (const token of tokens) {
      for (const target of cardTokens) {
        bestToken = Math.max(bestToken, tokenSimilarity(token, target));
      }
    }
    if (bestToken < 0.58) continue;
    const score = nameSimilarity(normalizedQuery, card.name);
    if (score < 0.42) continue;
    const existing = byName.get(card.name);
    if (existing === undefined || score > existing) byName.set(card.name, score);
  }

  return [...byName.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES);
}

function qTokens(normalizedQuery: string): string[] {
  return normalizedQuery.split(" ").filter(Boolean);
}

function tokenAlignmentScore(normalizedQuery: string, cardName: string): number {
  const q = qTokens(normalizedQuery).filter((token) => token.length > 1);
  const c = normalizeCardName(cardName).split(" ").filter(Boolean);
  if (q.length === 0 || c.length === 0) return 0;

  if (q.length === 1) {
    const token = q[0] ?? "";
    const first = c[0] ?? "";
    let score = Math.max(
      tokenSimilarity(token, first),
      consonantSimilarity(token, first),
      ...c.map((target) => tokenSimilarity(token, target) * 0.96),
    );
    if (token.length >= 7 && first.length < token.length * 0.65) {
      score *= 0.7;
    }
    if (token.length >= 8 && first.length <= 7) {
      score *= 0.75;
    }
    return score;
  }

  return flexibleTokenAlignment(q, c);
}

function flexibleTokenAlignment(query: string[], cardTokens: string[]): number {
  const used = new Set<number>();
  let sum = 0;
  let weight = 0;
  let i = 0;

  while (i < query.length) {
    const token = query[i] ?? "";
    const next = query[i + 1];
    const tokenWeight = i === 0 ? 1.6 : token.length <= 3 ? 0.55 : 1;
    const single = bestUnusedTokenScore(token, cardTokens, used, i);
    let pairScore = 0;
    let pairIdx = -1;
    if (next) {
      const collapsed = `${token}${next}`;
      const pair = bestUnusedTokenScore(collapsed, cardTokens, used, i);
      pairScore = pair.score;
      pairIdx = pair.index;
    }

    if (pairIdx >= 0 && pairScore > single.score + 0.06) {
      used.add(pairIdx);
      sum += pairScore * Math.max(tokenWeight, 1.2);
      weight += Math.max(tokenWeight, 1.2);
      i += 2;
      continue;
    }

    if (single.index >= 0) used.add(single.index);
    sum += single.score * tokenWeight;
    weight += tokenWeight;
    i += 1;
  }

  return weight <= 0 ? 0 : sum / weight;
}

function bestUnusedTokenScore(
  token: string,
  cardTokens: string[],
  used: Set<number>,
  queryIndex: number,
): { score: number; index: number } {
  let best = 0;
  let bestIdx = -1;
  for (let j = 0; j < cardTokens.length; j += 1) {
    if (used.has(j)) continue;
    const target = cardTokens[j] ?? "";
    const sim = Math.max(
      tokenSimilarity(token, target),
      consonantSimilarity(token, target),
    );
    const positional =
      j === queryIndex ? 1.12 : Math.abs(j - queryIndex) === 1 ? 1.04 : j === queryIndex + 2 ? 0.98 : 1;
    const score = sim * positional;
    if (score > best) {
      best = score;
      bestIdx = j;
    }
  }
  return { score: best, index: bestIdx };
}

function tokenCoverageScore(normalizedQuery: string, cardName: string): number {
  const qTokensList = qTokens(normalizedQuery).filter((token) => token.length > 1);
  const cTokens = normalizeCardName(cardName).split(" ").filter(Boolean);
  if (qTokensList.length === 0) return 0;
  if (qTokensList.length === 1) {
    const q = qTokensList[0] ?? "";
    const best = Math.max(
      ...cTokens.map((token) => tokenSimilarity(q, token)),
      consonantSimilarity(q, cTokens.join("")),
    );
    return best;
  }

  let covered = 0;
  for (let i = 0; i < qTokensList.length; i += 1) {
    const q = qTokensList[i] ?? "";
    const next = qTokensList[i + 1];
    const positional = tokenSimilarity(q, cTokens[i] ?? "");
    const bestAny = cTokens.reduce(
      (best, token) => Math.max(best, tokenSimilarity(q, token)),
      0,
    );
    const collapsed = next
      ? cTokens.reduce(
          (best, token) => Math.max(best, tokenSimilarity(`${q}${next}`, token)),
          0,
        )
      : 0;
    if (Math.max(positional, bestAny * 0.82, collapsed) >= 0.5) covered += 1;
  }
  return covered / qTokensList.length;
}

function lengthAffinity(query: string, name: string): number {
  const qLen = query.replace(/\s+/g, "").length;
  const nameLen = normalizeCardName(name).replace(/\s+/g, "").length;
  if (qLen <= 4 || nameLen === 0) return 1;
  const ratio = nameLen / qLen;
  if (ratio < 0.65) return 0.72;
  if (ratio > 2.2) return 0.88;
  return 1;
}

function consonantNeighbors(index: CardIndex, normalizedQuery: string): CardMatch[] {
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const compact = normalizedQuery.replace(/\s+/g, "");
  if (compact.length < 6) return [];

  const queryConsonants = consonants(compact);
  if (queryConsonants.length < 4) return [];

  const byName = new Map<string, number>();
  for (const card of index.cards) {
    const cardTokens = card.normalized.split(" ").filter(Boolean);
    const targets =
      tokens.length === 1 && cardTokens.length > 1
        ? [cardTokens[0] ?? "", card.normalized.replace(/\s+/g, "")]
        : [card.normalized.replace(/\s+/g, "")];

    let best = 0;
    for (const target of targets) {
      const targetConsonants = consonants(target);
      if (Math.abs(targetConsonants.length - queryConsonants.length) > 6) continue;
      const score = consonantSimilarity(compact, target);
      best = Math.max(best, score);
    }
    if (best < 0.5) continue;

    const full = nameSimilarity(normalizedQuery, card.name);
    const combined = Math.max(full, best * 0.96);
    if (combined < 0.45) continue;
    const existing = byName.get(card.name);
    if (existing === undefined || combined > existing) byName.set(card.name, combined);
  }

  return [...byName.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES);
}

function longestCommonSubsequence(a: string, b: string): number {
  if (!a || !b) return 0;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] ?? 0) + 1
          : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }
  return prev[n] ?? 0;
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const canonicalA = FUNCTION_WORDS[a];
  const canonicalB = FUNCTION_WORDS[b] ?? b;
  if (canonicalA && canonicalA === canonicalB) return 0.92;
  const maxLen = Math.max(a.length, b.length);
  const edit = 1 - levenshtein(a, b) / maxLen;
  const prefix =
    b.startsWith(a) || a.startsWith(b)
      ? 0.72 + (0.28 * Math.min(a.length, b.length)) / maxLen
      : 0;
  const lcs = (2 * longestCommonSubsequence(a, b)) / (a.length + b.length);
  const consonants = consonantSimilarity(a, b);
  return Math.max(edit, prefix, lcs, consonants * 0.94);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) dp[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((prev ?? 0) + cost, (dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1);
      prev = tmp;
    }
  }
  return dp[b.length] ?? b.length;
}

function searchFuzzy(
  index: CardIndex,
  rawQuery: string,
  normalizedQuery: string,
): CardMatch[] {
  const engine = getFuse(index);
  const results = engine.search(rawQuery.trim() || normalizedQuery, {
    limit: 16,
  });

  return results.flatMap((result) => {
    const fuseScore = result.score ?? 1;
    const similarity = Math.max(
      0,
      1 - fuseScore,
      nameSimilarity(normalizedQuery, result.item.name),
    );
    if (similarity < 0.5) return [];
    return [{ name: result.item.name, score: similarity }];
  });
}

function getFuse(index: CardIndex) {
  if (fuse && fuseIndex === index) return fuse;
  fuseIndex = index;
  fuse = new Fuse(index.cards, {
    includeScore: true,
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: ["searchName", "normalized"],
  });
  return fuse;
}

function prefixNeighbors(index: CardIndex, normalizedQuery: string): CardMatch[] {
  const first = normalizedQuery.split(" ")[0] ?? "";
  if (normalizedQuery.length < 4 || first.length < 4) return [];

  const byName = new Map<string, number>();
  for (const card of index.cards) {
    const cardNorm = card.normalized;
    if (!cardNorm) continue;
    const isPrefix =
      cardNorm === normalizedQuery ||
      cardNorm.startsWith(`${normalizedQuery} `) ||
      cardNorm === first ||
      cardNorm.startsWith(`${first} `);
    if (!isPrefix) continue;
    const score = nameSimilarity(normalizedQuery, card.name);
    const existing = byName.get(card.name);
    if (existing === undefined || score > existing) byName.set(card.name, score);
  }

  return [...byName.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES);
}

function firstTokenNeighbors(index: CardIndex, normalizedQuery: string): CardMatch[] {
  const first = normalizedQuery.split(" ")[0] ?? "";
  if (first.length < 4) return [];

  const byName = new Map<string, number>();
  for (const card of index.cards) {
    const cardFirst = card.normalized.split(" ")[0] ?? "";
    if (cardFirst.length < 4) continue;
    if (Math.abs(cardFirst.length - first.length) > 6) continue;
    const initial = first[0];
    const other = cardFirst[0];
    if (initial && other && initial !== other) {
      if (levenshtein(initial, other) > 1) continue;
    }
    const tokenSim = Math.max(
      tokenSimilarity(first, cardFirst),
      consonantSimilarity(first, cardFirst),
    );
    if (tokenSim < 0.42) continue;
    const score = nameSimilarity(normalizedQuery, card.name);
    if (score < 0.45) continue;
    const existing = byName.get(card.name);
    if (existing === undefined || score > existing) byName.set(card.name, score);
  }

  return [...byName.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES);
}

function combinedScore(similarity: number, ocrConfidence: number): number {
  const ocr = Math.min(1, Math.max(0, ocrConfidence));
  return similarity * (0.55 + 0.45 * ocr);
}
