// functions-reports/src/index.ts
// CommonJS-aggregator för tunga rapport-endpoints i codebase "reports".

import { saveReportManifest } from "./saveReportManifest";

// Lägg ev. fler exports här framöver, t.ex.
// import { buildCO2Preview } from "./buildCO2Preview";

module.exports = {
    saveReportManifest,
    // buildCO2Preview,
};
