/** Decompress a gzip payload to text with the platform's built-in DecompressionStream (Node and WebKit). */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
