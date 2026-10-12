// Minimal AudioWorkletGlobalScope typings (not shipped in TS DOM lib).
declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean;
  },
): void;
