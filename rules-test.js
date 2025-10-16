/**
 * Run against the Firestore EMULATOR.
 * Start emulator in another terminal:
 *   npx firebase emulators:start --only firestore --project demo-rules-test
 * Make sure firebase.json has firestore.host=127.0.0.1 and firestore.port=8085
 * Then: node rules-test.js
 */
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc } = require("firebase/firestore");

(async () => {
  const PROJECT_ID = "demo-rules-test";
  const FIRESTORE_HOST = "127.0.0.1";
  const FIRESTORE_PORT = 8085;
  const RULES_PATH = path.join(process.cwd(), "firestore.rules");
  const rulesText = fs.readFileSync(RULES_PATH, "utf8");

  // Init test env AND load rules here
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: rulesText,
    },
  });

  // Helper: seed data with rules disabled
  async function seed(fn) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await fn(db);
    });
  }

  // Auth contexts
  const adminCtx = testEnv.authenticatedContext("admin-user", {
    role: "admin",
    admin: true,
    roles: { admin: true },
    email: "admin@example.com",
  });
  const userCtx = testEnv.authenticatedContext("normal-user", {
    role: "user",
    email: "user@example.com",
  });

  const adminDb = adminCtx.firestore();
  const userDb  = userCtx.firestore();

  // IDs
  const goodType = "laptop";
  const inactiveType = "old-monitor";
  const zeroFactorType = "zero-type";
  const invDoc1 = "it-1";
  const invDoc2 = "it-2";
  const invDoc3 = "it-3";
  const invDoc4 = "it-4";

  // Seed: productTypes + one itInventory doc
  await seed(async (db) => {
    await setDoc(doc(db, "productTypes", goodType), {
      label: "Laptop",
      active: true,
      medianWeightKg: 1.8,
      co2PerUnitKg: 22.5,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "productTypes", inactiveType), {
      label: "CRT Monitor",
      active: false,
      medianWeightKg: 8.0,
      co2PerUnitKg: 50.0,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "productTypes", zeroFactorType), {
      label: "Mystery Box",
      active: true,
      medianWeightKg: 0,
      co2PerUnitKg: 0,
      schemaVersion: 1,
    });
    await setDoc(doc(db, "itInventory", invDoc1), {
      customer: "Convit",
      completed: false,
      reuse: false,
      resold: false,
      scrap: false,
    });
  });

  // Payload satisfying exactlyOneStatus when completed=true
  const baseCompleted = {
    completed: true,
    reuse: true,
    resold: false,
    scrap: false,
  };

  // 1) DENY: missing productTypeId
  await assertFails(
    setDoc(doc(userDb, "itInventory", invDoc2), {
      customer: "Convit",
      ...baseCompleted,
      productType: "Laptop",
    })
  ).then(() => console.log("✔️  Nekade saknat productTypeId (förväntat)"));

  // 2) DENY: inactive type
  await assertFails(
    setDoc(doc(userDb, "itInventory", invDoc3), {
      customer: "Convit",
      ...baseCompleted,
      productTypeId: inactiveType,
      productType: "CRT Monitor",
    })
  ).then(() => console.log("✔️  Nekade inaktiv produkttyp (förväntat)"));

  // 3) DENY: zero factors
  await assertFails(
    setDoc(doc(userDb, "itInventory", invDoc4), {
      customer: "Convit",
      ...baseCompleted,
      productTypeId: zeroFactorType,
      productType: "Mystery Box",
    })
  ).then(() => console.log("✔️  Nekade typ med noll-faktorer (förväntat)"));

  // 4) ALLOW: valid type
  await assertSucceeds(
    setDoc(doc(userDb, "itInventory", "inv-ok-create"), {
      customer: "Convit",
      ...baseCompleted,
      productTypeId: goodType,
      productType: "Laptop",
    })
  ).then(() => console.log("✔️  Tillät completed=true med giltig typ (förväntat)"));

  // 5) UPDATE: set completed=true on existing doc
  await assertSucceeds(
    setDoc(doc(userDb, "itInventory", invDoc1), {
      customer: "Convit",
      ...baseCompleted,
      productTypeId: goodType,
      productType: "Laptop",
    })
  ).then(() => console.log("✔️  Update: tillät completed=true med giltig typ (förväntat)"));

  // 6) DENY: try to UPDATE invoiceReportId from client
  await assertFails(
    updateDoc(doc(userDb, "itInventory", invDoc1), {
      invoiceReportId: "HACK",
    })
  ).then(() => console.log("✔️  Update: nekade ändring av invoiceReportId (förväntat)"));

  await testEnv.cleanup();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
