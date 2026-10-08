/** Apple names downloaded keys AuthKey_<KEYID>.p8. Treat it as a hint the user can correct. */
export function keyIdFromFileName(name: string | undefined | null): string | null {
  const match = /AuthKey_([A-Z0-9]{8,12})\.p8$/i.exec(name ?? "");
  return match ? match[1]!.toUpperCase() : null;
}
