import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Event ownership and effect dependencies are enforced on the chat interaction layer.
export default [{
  files: [
    'desktop/renderer/chat/page.tsx',
    'desktop/renderer/chat/hooks/*.ts',
    'desktop/renderer/chat/components/navigation.tsx',
    'desktop/renderer/shared/hooks/use-menu-dismiss.ts',
    'desktop/renderer/shared/components/{message-menu,context-menu}.tsx',
  ],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
    'no-restricted-imports': ['error', { paths: [{ name: 'ahooks', message: 'Import the needed hook directly from ahooks/es/... to keep the chat bundle small.' }] }],
  },
}];
