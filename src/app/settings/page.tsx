import { connection } from "next/server";
import { Suspense } from "react";
import { AscConnectionForm, ConnectedAsc } from "@/components/settings/connection-forms";
import { READINESS_FALLBACK, SettingsScreen } from "@/components/settings/settings-screen";
import { connectionStatus } from "@/lib/server/connections";
import { assertCanAccessPrivateData } from "@/lib/server/access";
import { checkAppStoreConnect, removeAppStoreConnect, saveAppStoreConnect, saveVendorNumber } from "./actions";
import { AppReadinessList } from "./app-readiness";

export default async function SettingsPage() {
  await connection(); // saved-key status is read from disk per request
  await assertCanAccessPrivateData();
  const status = connectionStatus().appStoreConnect;
  return (
    <SettingsScreen
      intro="Connect read-only keys. Reports are fetched by this server; keys are encrypted at rest and never sent back to the browser."
      configured={status.configured}
      form={<AscConnectionForm save={saveAppStoreConnect} />}
      connected={status.configured && (
        <ConnectedAsc keyId={status.keyId} vendorTail={status.vendorTail} savedAt={status.savedAt}
          check={checkAppStoreConnect} remove={removeAppStoreConnect} saveVendor={saveVendorNumber}
          removeConfirm="Remove this key from the server? Reports will switch back to sample data." />
      )}
      readiness={<Suspense fallback={READINESS_FALLBACK}><AppReadinessList /></Suspense>}
      guideFooter="Analytics Reports need a one-time ongoing report request per app, created with an Admin key. After you connect, this page lists which apps are missing it and gives you a script to run locally. This app never creates one itself."
    />
  );
}
