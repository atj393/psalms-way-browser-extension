import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", "brag-output/**", "psalms.json"],
  },
  js.configs.recommended,
  {
    // Extension source: runs in the popup, so browser globals plus `chrome`.
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
    rules: {
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
      // The whole point of the DOM helpers is that nothing assigns markup.
      "no-restricted-properties": [
        "error",
        { object: "document", property: "write", message: "Build nodes with the DOM API." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression > MemberExpression[property.name='innerHTML']",
          message: "Use textContent or the helpers in dom.js; never assign innerHTML.",
        },
        {
          selector: "AssignmentExpression > MemberExpression[property.name='outerHTML']",
          message: "Use textContent or the helpers in dom.js; never assign outerHTML.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Use the DOM API rather than parsing markup.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "Manifest V3 forbids dynamic code evaluation.",
        },
      ],
    },
  },
  {
    // Tooling and tests run in Node.
    files: ["scripts/**/*.js", "test/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // The smoke test drives a browser, and DOM suites run under jsdom, so both
    // touch the browser globals as well as Node's.
    files: ["scripts/smoke-test.js", "test/**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, chrome: "readonly" },
    },
  },
];
