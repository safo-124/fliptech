// ESLint 9 flat config. eslint-config-next 16 exports flat-config arrays
// directly, so no FlatCompat bridge is needed (and FlatCompat in fact fails on
// it with a circular-structure error).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
];
