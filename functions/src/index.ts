// functions/src/index.ts
// Aggregator: exportera alla callables från codebase "functions".

import { wipeAllTestData } from "./wipeAllTestData";
import {
  setUserRole,
  // ⬇️ OBS: ta INTE med listUsers härifrån längre
  deleteUser,
  triggerPasswordReset,
  bootstrapMakeMeAdmin,
} from "./users";
import { setUserClaims } from "./claims";
import { vendorLookup } from "./vendor";
import { createInvoiceReport, deleteInvoiceReport } from "./invoicing";
import { whoAmI } from "./whoAmI";

import { buildCO2Preview } from "./reports/buildCO2Preview";
import { userProfileOnCreate } from "./userOnCreate";
import { deleteUserAccount } from "./adminUsers";


// ⬇️ NY: använd nya implementationen
import { listUsers as listUsers2 } from "./listUsers";

module.exports = {
  // Diagnostik / utility
  whoAmI,
  wipeAllTestData,

  // User admin
  setUserRole,
  listUsers: listUsers2,      
  deleteUser,
  triggerPasswordReset,
  bootstrapMakeMeAdmin,
  deleteUserAccount,

  // Profil-spegling
  userProfileOnCreate,

  // Claims/behörighet
  setUserClaims,

  // Vendor
  vendorLookup,

  // Fakturering
  createInvoiceReport,
  deleteInvoiceReport,

  // Rapporter
  buildCO2Preview,
};
