// Scryfall's language codes spelled out for the lot page's prose (VEG-624).
// The list is the languages Scryfall prints cards in that a collection is
// likely to hold; anything else reads as the code it came with.

const LANGUAGES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ko: 'Korean',
  zhs: 'Simplified Chinese',
  zht: 'Traditional Chinese',
}

/** A Scryfall language code as a word ("ja" to "Japanese"), or the code as given. */
export function languageName(code: string): string {
  return LANGUAGES[code] ?? code
}
