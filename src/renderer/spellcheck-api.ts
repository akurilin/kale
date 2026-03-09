//
// Typed preload bridge for the spellcheck API. Keeps renderer modules
// decoupled from the raw window global and gives us a single place
// to evolve the contract.
//

type SpellcheckApi = {
  /** Returns the subset of words that the OS spellchecker considers misspelled. */
  checkWords: (words: string[]) => string[];
  /** Returns spelling suggestions for a single misspelled word. */
  getSuggestions: (word: string) => string[];
  /** Adds a word to the OS custom dictionary (persisted across sessions). */
  addToDictionary: (word: string) => Promise<boolean>;
};

declare global {
  interface Window {
    spellcheckApi: SpellcheckApi;
  }
}

export const getSpellcheckApi = (): SpellcheckApi => window.spellcheckApi;
