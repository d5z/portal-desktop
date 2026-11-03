export default {
  extends: ['stylelint-config-standard-scss'],
  rules: {
    'selector-class-pattern': '^[a-z][a-zA-Z0-9-]*$',
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'property-no-unknown': [true, { ignoreProperties: ['-webkit-app-region'] }],
    // Electron drag regions and native control appearance require vendor rules.
    'property-no-vendor-prefix': null,
    'max-nesting-depth': 3,
    // Keep the existing media-query syntax and browser support during migration.
    'media-feature-range-notation': 'prefix',
    // Prettier owns whitespace; Stylelint owns CSS correctness and naming.
    'rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'at-rule-empty-line-before': null,
  },
  overrides: [
    {
      files: ['**/*.module.scss'],
      rules: { 'selector-class-pattern': '^[a-z][a-zA-Z0-9]*$' },
    },
    {
      // Upstream semantic font tokens use CSS font/line-height syntax, not Sass division.
      files: ['desktop/renderer/plugins/dsh/tokens.scss'],
      rules: { 'scss/operator-no-newline-after': null, 'scss/operator-no-unspaced': null },
    },
  ],
};
