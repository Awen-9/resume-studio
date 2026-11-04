import eslint from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-server',
      'node_modules',
      'playwright-report',
      'src-tauri',
      'test-results',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      'vue/no-mutating-props': 'off',
      'vue/require-default-prop': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
    },
  },
  {
    // 浏览器侧代码
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // 服务端、构建脚本和根目录配置文件跑在 Node 里
    files: ['server/**/*.ts', 'scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // 测试同时用到 DOM 和 Node 能力
    files: ['tests/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  /**
   * 分层边界。
   *
   * 目录结构本身不会阻止 `domain` 里 import 一个 Vue 组件；真正能阻止的是 lint。
   * 规则只写「不允许的方向」，允许的方向（features → domain/infrastructure、
   * server → domain）保持沉默，避免配置比代码还难维护。
   */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*',
                '@/infrastructure/*',
                '@/app/*',
                '@/shared/ui/*',
                '**/server/*',
              ],
              message: 'domain 是纯逻辑层：不能依赖 UI、存储或服务端，需要外部能力时用参数注入',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '**/server/*'],
              message: 'features 不能依赖应用装配层或服务端实现；跨进程能力走 infrastructure/api',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/app/*', '**/server/*'],
              message: 'infrastructure 只依赖 domain：反过来会让组件/服务端和存储实现互相牵制',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/app/*', '@/infrastructure/*'],
              message: 'server 只能复用 domain（以及自己的 services）',
            },
          ],
        },
      ],
    },
  },
)
