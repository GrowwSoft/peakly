import { z } from "zod";
import { normalizePrivateKey } from "./asc/jwt";

/** Validation for a saved App Store Connect connection, shared by the web server and the Mac app. */
export const ascCredentialsSchema = z.object({
  issuerId: z.string().trim().regex(/^[0-9a-f-]{36}$/i, "Issuer ID is a UUID from App Store Connect → Users and Access → Integrations."),
  keyId: z.string().trim().regex(/^[A-Z0-9]{8,12}$/, "Key ID is the 10-character ID shown next to the key."),
  privateKey: z.string().trim()
    .transform(normalizePrivateKey)
    .refine((k) => k.includes("-----BEGIN PRIVATE KEY-----") && k.includes("-----END PRIVATE KEY-----"), "Paste the full contents of the .p8 file, including the BEGIN/END lines."),
  /** Optional: only Sales reports need it. Empty means "sales not configured", never zero sales. */
  vendorNumber: z.string().trim().regex(/^(\d{6,12})?$/, "Vendor number is in Payments and Financial Reports (top left).").default(""),
});
