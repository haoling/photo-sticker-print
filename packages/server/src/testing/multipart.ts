export type Part =
  { name: string; value: string } | { name: string; filename: string; data: Buffer };

/** テスト用に multipart/form-data の本文を組み立てる */
export function multipartBody(parts: Part[]) {
  const boundary = '----test-boundary';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ('value' in p) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        p.data,
        Buffer.from('\r\n'),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export const field = (name: string, value: string): Part => ({ name, value });
export const file = (cell: number, data: Buffer): Part => ({
  name: `cell-${cell}`,
  filename: `p${cell}.jpg`,
  data,
});
