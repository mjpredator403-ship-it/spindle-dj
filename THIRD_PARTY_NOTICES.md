# Third-party notices

## Shipped in the app (runtime)

**None.** The application bundle in `dist/` consists of Spindle DJ's own GPL-3.0-or-later source code. It contains no third-party runtime libraries, fonts, images, samples, impulse responses or codecs:

* Audio decoding uses the browser's built-in decoders.
* The reverb impulse response is generated procedurally at runtime.
* Fonts are the operating system's.
* The build tool may inject a few lines of Vite's module-preload helper (MIT License, © 2019-present VoidZero Inc. and Vite contributors).

## Development and test tools (not shipped)

| Package | Version | License | Use |
|---|---|---|---|
| vite | 8.3.4 | MIT | build / dev server |
| vitest | 5.0.3 | MIT | unit tests |
| typescript | 5.9.3 | Apache-2.0 | type checking / compilation |
| playwright-core (optional) | 1.64.0 | Apache-2.0 | browser automation for E2E tests |

Transitive build dependencies are listed in `package-lock.json`. All are under licenses compatible with distributing Spindle DJ under GPL-3.0-or-later.

## Published research used (no code copied)

* Krumhansl–Kessler key profiles (C. L. Krumhansl, *Cognitive Foundations of Musical Pitch*, 1990): numerical profile values used for key estimation.
* Linkwitz–Riley crossover topology and the RBJ “Audio EQ Cookbook” biquad formulas (as implemented natively by the Web Audio API).

## Trademarks

VirtualDJ is a trademark of Atomix Productions. Pioneer DJ, CDJ and DJM are trademarks of AlphaTheta Corporation. Spindle DJ is not affiliated with, endorsed by, or derived from their software, artwork or interface assets.
