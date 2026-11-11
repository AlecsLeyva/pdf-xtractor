/** Decodificador uuencode mínimo, usado para preparar fixtures de libarchive. */
export function uudecode(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const chunks = [];
  let inside = false;

  for (const line of lines) {
    if (line.startsWith('begin ')) {
      inside = true;
      continue;
    }
    if (line.trim() === 'end') break;
    if (!inside || line.length === 0) continue;

    const length = (line.charCodeAt(0) - 32) & 63;
    if (length === 0) continue;

    const bytes = [];
    for (let index = 1; index < line.length; index += 4) {
      const chars = [0, 1, 2, 3].map(
        (offset) => ((line.charCodeAt(index + offset) || 32) - 32) & 63,
      );

      bytes.push(
        ((chars[0] << 2) | (chars[1] >> 4)) & 0xff,
        ((chars[1] << 4) | (chars[2] >> 2)) & 0xff,
        ((chars[2] << 6) | chars[3]) & 0xff,
      );
    }

    chunks.push(Buffer.from(bytes).subarray(0, length));
  }

  return Buffer.concat(chunks);
}
