import { safeHttpUrl } from "@/lib/security";

export interface LinkifySegment {
  type: "text" | "link";
  value: string;
  href: string | null;
}

// Shared/pasted URLs percent-encode anything non-ASCII, so whitespace,
// quotes, CJK punctuation/kana (U+3000-30FF), ideographs (U+4E00-9FFF), and
// fullwidth forms (U+FF00-FFEF) terminate a match — "看这个https://a.com很好玩"
// links only the URL.
const URL_CANDIDATE =
  /(?:https?:\/\/|www\.)[^\s<>"'　-ヿ一-鿿＀-￯]+/gi;

// ASCII sentence punctuation that usually trails a URL in prose.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}>…]$/;

export function linkifyText(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const index = match.index ?? 0;
    let candidate = match[0];

    // Trailing punctuation belongs to the sentence, not the URL. A ")" is
    // kept while the URL still has an unmatched "(" (Wikipedia-style paths).
    while (candidate.length > 0) {
      const last = candidate[candidate.length - 1];
      if (last === ")") {
        const opens = candidate.split("(").length - 1;
        const closes = candidate.split(")").length - 1;
        if (closes <= opens) break;
      } else if (!TRAILING_PUNCTUATION.test(last)) {
        break;
      }
      candidate = candidate.slice(0, -1);
    }

    const href = safeHttpUrl(
      /^www\./i.test(candidate) ? `https://${candidate}` : candidate,
    );
    if (!href) continue;

    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index), href: null });
    }
    segments.push({ type: "link", value: candidate, href });
    lastIndex = index + candidate.length;
  }

  if (segments.length === 0) {
    return [{ type: "text", value: text, href: null }];
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex), href: null });
  }
  return segments;
}
