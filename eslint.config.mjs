import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const config = [...nextVitals, globalIgnores([".next-build/**"])];

export default config;
