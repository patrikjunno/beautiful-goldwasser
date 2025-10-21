"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAdmin = exports.getRoleFromClaims = exports.getAuth = exports.getDb = exports.getAdminApp = exports.REGION = void 0;
// functions-reports/src/_admin.ts
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
exports.REGION = "europe-west1";
function getAdminApp() {
    try {
        return admin.app();
    }
    catch {
        return admin.initializeApp();
    }
}
exports.getAdminApp = getAdminApp;
function getDb() {
    return getAdminApp().firestore();
}
exports.getDb = getDb;
function getAuth() {
    return getAdminApp().auth();
}
exports.getAuth = getAuth;
function getRoleFromClaims(claims) {
    const c = claims;
    const isAdmin = c?.role === "admin" ||
        c?.admin === true ||
        (c?.roles && c.roles.admin === true);
    if (isAdmin)
        return "admin";
    if (c?.role === "customer")
        return "customer";
    return "user";
}
exports.getRoleFromClaims = getRoleFromClaims;
function assertAdmin(req) {
    if (!req.auth) {
        throw new https_1.HttpsError("unauthenticated", "Måste vara inloggad.");
    }
    const role = getRoleFromClaims(req.auth.token);
    if (role !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Endast admin.");
    }
}
exports.assertAdmin = assertAdmin;
