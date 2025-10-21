// functions/src/index.ts
// Aggregator: exportera alla callables från codebase "functions".

import { wipeAllTestData } from "./wipeAllTestData";
import {
  setUserRole,
  listUsers,
  deleteUser,
  triggerPasswordReset,
  bootstrapMakeMeAdmin,
} from "./users";
import { setUserClaims } from "./claims";
import { vendorLookup } from "./vendor";
import { createInvoiceReport, deleteInvoiceReport } from "./invoicing";
import { whoAmI } from "./whoAmI";

import { buildCO2Preview } from "./reports/buildCO2Preview";

module.exports = {
  // Diagnostik / utility
  whoAmI,
  wipeAllTestData,

  // User admin
  setUserRole,
  listUsers,
  deleteUser,
  triggerPasswordReset,
  bootstrapMakeMeAdmin,

  // Claims/behörighet
  setUserClaims,

  // Vendor
  vendorLookup,

  // Fakturering
  createInvoiceReport,
  deleteInvoiceReport,

  // ✅ Lägg TILL denna export:
  buildCO2Preview,
};
