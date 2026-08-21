import { describe, expect, it } from 'vitest';

import { CodexIpcFrameDecoder, encodeCodexIpcFrame } from './framing';

describe('Codex IPC framing', () => {
  it('prefixes JSON with its unsigned little-endian byte length', () => {
    const frame = encodeCodexIpcFrame({ type: 'test', value: '✓' });
    const jsonBytes = Buffer.from('{"type":"test","value":"✓"}', 'utf8');

    expect(frame.readUInt32LE(0)).toBe(jsonBytes.length);
    expect(frame.subarray(4)).toEqual(jsonBytes);
  });

  it('decodes fragmented and consecutive frames without losing bytes', () => {
    const decodedMessages: unknown[] = [];
    const decoder = new CodexIpcFrameDecoder((message) => {
      decodedMessages.push(message);
    });
    const firstFrame = encodeCodexIpcFrame({ type: 'first' });
    const secondFrame = encodeCodexIpcFrame({ type: 'second' });
    const combinedFrames = Buffer.concat([firstFrame, secondFrame]);

    decoder.push(combinedFrames.subarray(0, 2));
    decoder.push(combinedFrames.subarray(2, firstFrame.length + 3));
    decoder.push(combinedFrames.subarray(firstFrame.length + 3));

    expect(decodedMessages).toEqual([{ type: 'first' }, { type: 'second' }]);
  });

  it('rejects frames larger than the configured safety limit', () => {
    const decoder = new CodexIpcFrameDecoder(() => undefined, 8);
    const oversizedHeader = Buffer.alloc(4);
    oversizedHeader.writeUInt32LE(9, 0);

    expect(() => decoder.push(oversizedHeader)).toThrow(
      'Codex IPC frame exceeds the 8-byte limit',
    );
  });
});
