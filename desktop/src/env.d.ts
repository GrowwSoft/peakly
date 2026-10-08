/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** VoteWant board ID for the Feedback section (overrides DEFAULT_FEEDBACK_BOARD in src/core/links.ts). */
  readonly VITE_VOTEWANT_BOARD?: string;
}
