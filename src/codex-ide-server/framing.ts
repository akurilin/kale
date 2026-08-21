const DEFAULT_MAXIMUM_CODEX_IPC_FRAME_BYTES = 256 * 1024 * 1024;
const CODEX_IPC_FRAME_HEADER_BYTES = 4;

/**
 * Why: Codex IPC is a binary stream, so each JSON message needs the same
 * little-endian length prefix used by the official IDE integration.
 */
export const encodeCodexIpcFrame = (message: unknown) => {
  const jsonBytes = Buffer.from(JSON.stringify(message), 'utf8');
  const frame = Buffer.allocUnsafe(
    CODEX_IPC_FRAME_HEADER_BYTES + jsonBytes.length,
  );
  frame.writeUInt32LE(jsonBytes.length, 0);
  jsonBytes.copy(frame, CODEX_IPC_FRAME_HEADER_BYTES);
  return frame;
};

export class CodexIpcFrameDecoder {
  private bufferedBytes = Buffer.alloc(0);

  /**
   * Why: socket chunks do not align with message boundaries, so one stateful
   * decoder must retain partial frames between data events.
   */
  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly maximumFrameBytes = DEFAULT_MAXIMUM_CODEX_IPC_FRAME_BYTES,
  ) {}

  /**
   * Why: one socket chunk can contain a partial frame or many complete frames,
   * so parsing continues until only an incomplete frame remains.
   */
  push(chunk: Buffer) {
    this.bufferedBytes = Buffer.concat([this.bufferedBytes, chunk]);

    while (this.bufferedBytes.length >= CODEX_IPC_FRAME_HEADER_BYTES) {
      const frameBytes = this.bufferedBytes.readUInt32LE(0);
      if (frameBytes > this.maximumFrameBytes) {
        throw new Error(
          `Codex IPC frame exceeds the ${this.maximumFrameBytes}-byte limit`,
        );
      }

      const completeFrameBytes = CODEX_IPC_FRAME_HEADER_BYTES + frameBytes;
      if (this.bufferedBytes.length < completeFrameBytes) {
        return;
      }

      const jsonText = this.bufferedBytes
        .subarray(CODEX_IPC_FRAME_HEADER_BYTES, completeFrameBytes)
        .toString('utf8');
      this.bufferedBytes = this.bufferedBytes.subarray(completeFrameBytes);
      this.onMessage(JSON.parse(jsonText) as unknown);
    }
  }
}
