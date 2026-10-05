import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import reactHooks from "eslint-plugin-react-hooks";

// React Compiler is not enabled. Preserve the existing hooks checks during the
// security upgrade; adopting compiler diagnostics is a separate, scoped task.
const compilerRules = Object.fromEntries(Object.keys(reactHooks.configs.recommended.rules)
  .filter((rule) => !["react-hooks/rules-of-hooks", "react-hooks/exhaustive-deps"].includes(rule))
  .map((rule) => [rule, "off"]));

export default defineConfig([
  ...nextCoreWebVitals,
  { ignores: ["test-results/**", "playwright-report/**", "supabase/functions/**"] },
  { rules: compilerRules },
]);
