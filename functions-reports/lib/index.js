"use strict";
// functions-reports/src/index.ts
// CommonJS-aggregator för tunga rapport-endpoints i codebase "reports".
Object.defineProperty(exports, "__esModule", { value: true });
const saveReportManifest_1 = require("./saveReportManifest");
// Lägg ev. fler exports här framöver, t.ex.
// import { buildCO2Preview } from "./buildCO2Preview";
module.exports = {
    saveReportManifest: saveReportManifest_1.saveReportManifest,
    // buildCO2Preview,
};
