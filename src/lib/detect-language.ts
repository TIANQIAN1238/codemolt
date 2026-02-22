import { francAll } from "franc-min";

// ==================== Post Content Language Detection ====================
// Detects the language of post content and returns a BCP 47 primary language subtag.
// franc-min detects 76 languages: 61 via trigram analysis + 15 via Unicode script detection.
// Source: https://github.com/wooorm/franc/tree/main/packages/franc-min

/**
 * Complete mapping of franc-min's 76 ISO 639-3 codes to BCP 47 primary language subtags.
 * 61 trigram-detected languages (Latin, Cyrillic, etc.) + 15 script-detected languages (CJK, Indic, etc.).
 */
const FRANC_TO_BCP47 = {
  cmn: "zh", // Mandarin Chinese
  spa: "es", // Spanish
  eng: "en", // English
  rus: "ru", // Russian
  arb: "ar", // Standard Arabic
  ben: "bn", // Bengali
  hin: "hi", // Hindi
  por: "pt", // Portuguese
  ind: "id", // Indonesian
  jpn: "ja", // Japanese
  fra: "fr", // French
  deu: "de", // German
  jav: "jv", // Javanese
  kor: "ko", // Korean
  tel: "te", // Telugu
  vie: "vi", // Vietnamese
  mar: "mr", // Marathi
  ita: "it", // Italian
  tam: "ta", // Tamil
  tur: "tr", // Turkish
  urd: "ur", // Urdu
  guj: "gu", // Gujarati
  pol: "pl", // Polish
  ukr: "uk", // Ukrainian
  kan: "kn", // Kannada
  mai: "mai", // Maithili (no ISO 639-1, BCP 47 uses ISO 639-3)
  mal: "ml", // Malayalam
  pes: "fa", // Iranian Persian
  mya: "my", // Burmese
  swh: "sw", // Swahili
  sun: "su", // Sundanese
  ron: "ro", // Romanian
  pan: "pa", // Panjabi
  bho: "bho", // Bhojpuri (no ISO 639-1)
  amh: "am", // Amharic
  hau: "ha", // Hausa
  fuv: "ff", // Nigerian Fulfulde → Fula
  bos: "bs", // Bosnian
  hrv: "hr", // Croatian
  nld: "nl", // Dutch
  srp: "sr", // Serbian
  tha: "th", // Thai
  ckb: "ckb", // Central Kurdish (no ISO 639-1)
  yor: "yo", // Yoruba
  uzn: "uz", // Northern Uzbek
  zlm: "ms", // Malay (individual)
  ibo: "ig", // Igbo
  npi: "ne", // Nepali
  ceb: "ceb", // Cebuano (no ISO 639-1)
  skr: "skr", // Saraiki (no ISO 639-1)
  tgl: "tl", // Tagalog
  hun: "hu", // Hungarian
  azj: "az", // North Azerbaijani
  sin: "si", // Sinhala
  koi: "kv", // Komi-Permyak → Komi
  ell: "el", // Modern Greek
  ces: "cs", // Czech
  mag: "mag", // Magahi (no ISO 639-1)
  run: "rn", // Rundi
  bel: "be", // Belarusian
  plt: "mg", // Plateau Malagasy → Malagasy
  qug: "qu", // Chimborazo Highland Quichua → Quechua
  mad: "mad", // Madurese (no ISO 639-1)
  nya: "ny", // Nyanja
  zyb: "za", // Yongbei Zhuang → Zhuang
  pbu: "ps", // Northern Pashto → Pashto
  kin: "rw", // Kinyarwanda
  zul: "zu", // Zulu
  bul: "bg", // Bulgarian
  swe: "sv", // Swedish
  lin: "ln", // Lingala
  som: "so", // Somali
  hms: "hms", // Southern Qiandong Miao (no ISO 639-1)
  hnj: "hnj", // Hmong Njua (no ISO 639-1)
  ilo: "ilo", // Iloko (no ISO 639-1)
  kaz: "kk", // Kazakh
} as const satisfies Record<string, string>;

// TODO: CONTENT_LANGUAGES — BCP 47 subset for future frontend language filter UI
// export const CONTENT_LANGUAGES: Record<string, string> = {
//   en: "English", zh: "中文", ja: "日本語", ko: "한국어", es: "Español",
//   fr: "Français", de: "Deutsch", pt: "Português", ru: "Русский", ar: "العربية",
// };
// export function isContentLanguage(tag: string): boolean {
//   return tag in CONTENT_LANGUAGES;
// }

type FrancCode = keyof typeof FRANC_TO_BCP47;
type Bcp47Tag = (typeof FRANC_TO_BCP47)[FrancCode];

const BCP47_VALUES = new Set<string>(Object.values(FRANC_TO_BCP47));

/** Convert franc-min's ISO 639-3 result to BCP 47. */
function toBcp47(iso639_3: string): Bcp47Tag | null {
  if (iso639_3 in FRANC_TO_BCP47) {
    return FRANC_TO_BCP47[iso639_3 as FrancCode];
  }
  return null;
}

/** Validate a hint string as a known BCP 47 tag. */
function validHint(hint?: string): Bcp47Tag | null {
  return hint && BCP47_VALUES.has(hint) ? (hint as Bcp47Tag) : null;
}

// ==================== Post Default Language ====================
export const POST_DEFAULT_LANGUAGE: Bcp47Tag = "en";

// ==================== Markdown Stripping ====================

/** Strip markdown syntax that would interfere with language detection. */
function stripMarkdown(markdown: string): string {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, ""); // fenced code blocks
  text = text.replace(/`[^`]+`/g, ""); // inline code
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links → keep text
  text = text.replace(/https?:\/\/[^\s)]+/g, ""); // URLs
  text = text.replace(/<[^>]+>/g, ""); // HTML tags
  text = text.replace(/^#{1,6}\s+/gm, ""); // heading markers
  text = text.replace(/[*_~]{1,3}/g, ""); // emphasis markers
  text = text.replace(/\s+/g, " ").trim(); // collapse whitespace
  return text;
}

// ==================== Detection ====================

const MIN_LENGTH = 20;
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Detect the language of post content.
 *
 * Returns a BCP 47 primary language subtag (e.g. "en", "zh", "ja").
 *
 * Priority:
 * 1. Auto-detect from content (high confidence → use it)
 * 2. hint parameter as tiebreaker (low confidence / short text)
 * 3. fallback to DEFAULT_LANGUAGE ("en")
 *
 * @param content - Raw markdown content of the post
 * @param hint - Optional BCP 47 hint from the agent (e.g. "en", "zh", "ja")
 */
export function detectLanguage(content: string, hint?: string): Bcp47Tag {
  const stripped = stripMarkdown(content);

  if (stripped.length < MIN_LENGTH) {
    return validHint(hint) || POST_DEFAULT_LANGUAGE;
  }

  const results = francAll(stripped);

  if (results.length === 0 || results[0][0] === "und") {
    return validHint(hint) || POST_DEFAULT_LANGUAGE;
  }

  const [topCode, topScore] = results[0];

  if (topScore >= CONFIDENCE_THRESHOLD) {
    return toBcp47(topCode) || POST_DEFAULT_LANGUAGE;
  }

  return validHint(hint) || POST_DEFAULT_LANGUAGE;
}
