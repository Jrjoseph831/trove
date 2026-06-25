/**
 * Holding-name validation, shared by the client (instant feedback) and the
 * server (authoritative). Blocks impersonation of real companies/financial
 * firms (this is a fictional world) and profanity/slurs. Normalizes for common
 * evasion (spacing, punctuation, leetspeak).
 */

// Real companies & financial firms players shouldn't trade as. Lowercased;
// matched as whole-word runs and (for longer ones) de-spaced substrings.
const REAL_FIRMS = [
  "blackrock", "black rock", "vanguard", "berkshire", "berkshire hathaway",
  "goldman", "goldman sachs", "morgan stanley", "jpmorgan", "jp morgan",
  "jpmorgan chase", "chase", "bank of america", "merrill", "wells fargo",
  "citigroup", "citibank", "citadel", "bridgewater", "fidelity", "state street",
  "blackstone", "kkr", "carlyle", "apollo", "brookfield", "renaissance",
  "two sigma", "point72", "millennium", "wellington", "pimco", "invesco",
  "schwab", "robinhood", "soros", "icahn", "pershing square", "elliott",
  "sequoia", "andreessen", "andreessen horowitz", "tiger global", "softbank",
  "temasek",
  // mega brands
  "apple", "google", "alphabet", "microsoft", "amazon", "meta", "facebook",
  "tesla", "nvidia", "netflix", "disney", "walmart", "exxon", "chevron",
  "shell", "aramco", "saudi aramco", "samsung", "toyota", "coca cola",
  "cocacola", "pepsi", "pepsico", "nike", "adidas", "openai", "anthropic",
  "spacex", "oracle", "ibm", "intel", "nvidia", "visa", "mastercard", "paypal",
  "boeing", "lockheed", "raytheon", "pfizer", "moderna", "unitedhealth",
];

// Severe profanity/slurs — matched as a substring of the tightly-normalized
// (de-leeted, alphanumeric-only) name, so "f.u.c.k" / "n1gger" are caught.
const PROFANITY_SUBSTR = [
  "fuck", "motherfuck", "shit", "bullshit", "cunt", "bitch", "bastard",
  "dick", "cock", "pussy", "slut", "whore", "asshole", "jackass", "dumbass",
  "nigger", "nigga", "faggot", "retard", "spic", "chink", "kike", "wetback",
  "coon", "tranny", "dyke", "rapist", "rape", "molest", "pedophile", "pedo",
  "nazi", "hitler", "jizz", "wank", "twat", "prick", "douche", "boner",
  "handjob", "blowjob", "cumshot", "dildo", "bollocks", "wanker", "knob",
];

// Milder words — matched only as whole words to dodge the Scunthorpe problem
// (so "assistant"/"class"/"hello" are fine).
const PROFANITY_WORD = ["ass", "hell", "damn", "crap", "piss", "cum", "sex"];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deleet(s: string): string {
  return s
    .toLowerCase()
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");
}

function containsRun(words: string[], run: string[]): boolean {
  for (let i = 0; i + run.length <= words.length; i++) {
    let match = true;
    for (let j = 0; j < run.length; j++) {
      if (words[i + j] !== run[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export interface NameCheck {
  ok: boolean;
  reason?: string;
}

export function validateHoldingName(raw: string): NameCheck {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < 2) return { ok: false, reason: "A bit short — give it a name." };
  if (trimmed.length > 40) return { ok: false, reason: "That's too long." };
  if (!/[a-z]/i.test(trimmed)) return { ok: false, reason: "Use some letters." };

  const words = norm(trimmed).split(" ");
  const tightSpace = norm(trimmed).replace(/ /g, "");
  for (const firm of REAL_FIRMS) {
    const fwords = firm.trim().split(" ");
    const ftight = firm.replace(/ /g, "");
    if (containsRun(words, fwords)) {
      return { ok: false, reason: "That's a real company — pick your own name." };
    }
    if (ftight.length >= 6 && tightSpace.includes(ftight)) {
      return { ok: false, reason: "That's a real company — pick your own name." };
    }
  }

  const tight = deleet(trimmed).replace(/[^a-z0-9]/g, "");
  for (const bad of PROFANITY_SUBSTR) {
    if (tight.includes(bad)) return { ok: false, reason: "Let's keep it clean." };
  }
  const deleetedWords = deleet(norm(trimmed)).split(" ");
  for (const bad of PROFANITY_WORD) {
    if (words.includes(bad) || deleetedWords.includes(bad)) {
      return { ok: false, reason: "Let's keep it clean." };
    }
  }

  return { ok: true };
}
