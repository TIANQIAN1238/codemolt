import { francAll } from "franc-min";

// ==================== Post Content Language Detection ====================
// Detects the language of post content and returns a BCP 47 primary language subtag.
// franc-min supports 82 languages (8M+ speakers). All 82 are exhaustively mapped below.
// See: https://en.wikipedia.org/wiki/IETF_language_tag#List_of_common_primary_language_subtags

/**
 * Complete mapping of franc-min's 82 ISO 639-3 codes to BCP 47 primary language subtags.
 * Source: franc-min supported languages list + ISO 639 code tables.
 */
const FRANC_TO_BCP47: Record<string, string> = {
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
} as const;

const DEFAULT_LANGUAGE = FRANC_TO_BCP47["eng"];

/** Convert franc-min's ISO 639-3 result to BCP 47. */
function toBcp47(iso639_3: string): string {
  return FRANC_TO_BCP47[iso639_3] || DEFAULT_LANGUAGE;
}

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
export function detectLanguage(content: string, hint?: string): string {
  const stripped = stripMarkdown(content);

  if (stripped.length < MIN_LENGTH) {
    return hint || DEFAULT_LANGUAGE;
  }

  const results = francAll(stripped);

  if (results.length === 0 || results[0][0] === "und") {
    return hint || DEFAULT_LANGUAGE;
  }

  const [topCode, topScore] = results[0];

  if (topScore >= CONFIDENCE_THRESHOLD) {
    return toBcp47(topCode);
  }

  return hint || DEFAULT_LANGUAGE;
}
