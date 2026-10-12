# Roadmap

Planned, **not implemented** in v0.1 (no UI controls are shown for these):

1. **Key-lock / pitch-preserving time-stretch.** WSOLA or phase-vocoder in the deck worklet, with a quality toggle for slow devices.
2. **Headphone cue (PFL)** on multi-channel interfaces: route a 4-channel output where the device exposes it (`AudioContext` `maxChannelCount` ≥ 4), with a cue/master blend.
3. **Streaming decode for long mixes** (WebCodecs `AudioDecoder`): play tracks longer than the RAM cap.
4. **More effects**: bit-crusher, phaser, gate, beat-masher, plus a second FX slot per deck.
5. **Sampler** pads with one-shot / loop samples.
6. **Auto-mix** from the queue with tempo-matched transitions.
7. **Built-in controller presets** for popular class-compliant controllers (community contributed).
8. **Waveform colour by 3-band energy** and a beat-jump control.
9. **Native Linux edition** (Rust + PipeWire/JACK) reusing the pure DSP kernels, for dedicated DJ boxes.
10. MP3/Opus recording via WebCodecs `AudioEncoder`.
11. **Windows installer (.exe)**: a one-click Windows download that bundles the app, with a Start-menu shortcut and no WSL or Python needed.
