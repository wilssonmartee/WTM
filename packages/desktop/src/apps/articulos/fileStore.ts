/**
 * Utilidades de compresion del modulo Articulos.
 *
 * El DBF lo lee el CORE desde el servidor SMB y lo envia comprimido (gzip) al
 * navegador, que lo descomprime aqui antes de parsearlo. Usamos las APIs
 * nativas del navegador (Compression/DecompressionStream).
 */

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const cs = new CompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  if (typeof DecompressionStream === "undefined") return data;
  const ds = new DecompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
