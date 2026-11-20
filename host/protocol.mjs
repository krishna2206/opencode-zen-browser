export const MAX_OUTGOING_MESSAGE_BYTES = 1024 * 1024;
export const MAX_INCOMING_MESSAGE_BYTES = 16 * 1024 * 1024;

export function encodeNativeMessage(payload, maxBytes = MAX_OUTGOING_MESSAGE_BYTES) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  if (json.length > maxBytes) {
    throw new Error(`Native message exceeds ${maxBytes} byte limit (${json.length} bytes)`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export class NativeFrameDecoder {
  constructor(onMessage, maxBytes = MAX_INCOMING_MESSAGE_BYTES) {
    this.onMessage = onMessage;
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > this.maxBytes) {
        throw new Error(`Invalid native message frame length: ${length} (max ${this.maxBytes})`);
      }
      if (this.buffer.length < 4 + length) {
        break;
      }
      const raw = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      this.onMessage(JSON.parse(raw));
    }
  }
}
