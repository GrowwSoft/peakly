/** Result of saving a connection or vendor number, shown inline in the form. */
export interface SaveState {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<"issuerId" | "keyId" | "privateKey" | "vendorNumber", string>>;
  /** Non-secret fields echoed back so a failed save doesn't wipe the form. The private key is never echoed. */
  values?: { issuerId: string; keyId: string; vendorNumber: string };
}

export interface CheckResult {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export type SaveAction = (prev: SaveState, form: FormData) => Promise<SaveState>;
