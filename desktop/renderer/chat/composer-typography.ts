import type { CSSProperties } from "react";

/** Shared mirror metrics for composer textarea + markdown overlay (SPEC §2.3). */
export const COMPOSER_TYPOGRAPHY = {
  fontFamily: "inherit",
  fontSize: "15px",
  lineHeight: "22.5px",
  letterSpacing: "normal",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "8px",
  paddingLeft: "0px",
} as const satisfies CSSProperties;

export const composerTypographyStyle: CSSProperties = { ...COMPOSER_TYPOGRAPHY };

export const composerTypographyVars = {
  "--composer-font-size": COMPOSER_TYPOGRAPHY.fontSize,
  "--composer-line-height": COMPOSER_TYPOGRAPHY.lineHeight,
  "--composer-letter-spacing": COMPOSER_TYPOGRAPHY.letterSpacing,
  "--composer-padding-top": COMPOSER_TYPOGRAPHY.paddingTop,
  "--composer-padding-right": COMPOSER_TYPOGRAPHY.paddingRight,
  "--composer-padding-bottom": COMPOSER_TYPOGRAPHY.paddingBottom,
  "--composer-padding-left": COMPOSER_TYPOGRAPHY.paddingLeft,
} as CSSProperties;
