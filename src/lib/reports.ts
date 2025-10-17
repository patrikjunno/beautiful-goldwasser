// src/lib/reports.ts

// Firestore paths (SSOT)
export const REPORTS_COLLECTION = "reports" as const;
export const INVOICE_SUBCOLLECTION = "fakturor" as const;

// Cloud Function names (SSOT)
export const FN_DELETE_INVOICE_REPORT = "deleteInvoiceReport" as const;