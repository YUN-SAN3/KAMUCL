# 1.1.16 window adaptation implementation and independent installer initial review

## Window adaptation (implementation author; not an independent score)

- `uiWindowAutoFit` is optional and defaults to false. Appearance includes a searchable, native-semantic themed switch; failed saves explicitly restore its checked state.
- Enabled startup fits the restored/default rectangle into 92% of the actual selected display work area, in Electron device-independent pixels. The native minimum can shrink only in adaptive mode on small/high-DPI screens.
- Actual current content size determines an absolute fit factor against a 1120×740 comfort viewport. Display scale is never applied again. A separate manual zoom survives repeated settings saves, resize events and toggling. Larger monitors never enlarge beyond manual zoom.
- Existing 250% manual zoom is preserved. Ctrl-minus changes it by one normal step, Ctrl-zero resets its manual base to 100%; disabling returns that manual value.
- Maximize/fullscreen remains native and is never reversed. A removed/smaller display constrains a normal oversized/offscreen window. Minimized disable restores zoom; close cancels the debounce and unregisters screen callbacks.
- Default-off paths do not write zoom, bounds or minimum size, including existing 250% preference.

Verification: `npx tsc --noEmit` exited 0. `npx tsx --test tests/ui-window-fit-116.test.ts tests/window-maximize.test.ts tests/window-appearance.test.ts` passed 17/17, including eight new tests which exercise the controller with real EventEmitter scheduling and injected screen/window boundaries.

The incidental `npx vue-tsc --noEmit` tool was not installed as a project dependency and failed in the temporary npm cache with `ERR_PACKAGE_PATH_NOT_EXPORTED`; it is not a passed Vue validation. Ordinary TypeScript passed. Final production build and trusted-coordinate GUI acceptance are owned by root.

Actual GUI plan: record default-off bounds/zoom; trusted-coordinate enable/disable and saved restart; four themes; minimum window and usual 100/125/150% UI zoom; Ctrl +/-/0; repeated resize; native maximize/restore and hidden/visible; real display characteristics recorded. A mocked 1366×728 work area is a deterministic policy test, not evidence of a physical 1366×768 monitor. Do not change the user's display resolution for QA. The pictured 1.1.13 skin preview is not alone sufficient to prove a present camera defect.

## Installer observability (independent reviewer; not implementation author)

Reviewed root-owned `loaders.ts`, `java.ts`, `parallelProgress.ts`, `observedPreparation.ts`, `tests/installer-observability116.test.ts`, plus `out/installer116-tests-fixed.log` (16 passed).

- Shared Java preparation deduplicates by destination/major/architecture. Every current caller receives a progress replay and subsequent events; observer exceptions cannot fail other installations. Settled/failed work is not retained as a stale result.
- Loader runtime generation explicitly names pending prerequisites, then marks Java probing and installer-lock/process activity as running/indeterminate. Java readiness cannot finish the processor lane or report package completion.
- Nested lane state/indeterminate changes bypass stdout throttling, so a quickly reached running/done transition is not hidden until another log message arrives.
- Existing file-job ownership, writer drainage, hash checks, cancellation checks and transaction behavior remain intact in the reviewed changes. This is a state-observation improvement; it does not prove or resolve every external JVM/network stall.

Independent rerun: `npx tsx --test tests/installer-observability116.test.ts` passed 3/3; raw output retained in `out/installer116-independent-adaptive-review.log`.

No confirmed critical defect found in this scoped logic review. Preliminary reasonableness/functionality assessment: 9.0/8.9 for the observation changes. Appearance and the user's exact stuck import remain pending final GUI/diagnostic evidence; no visual score or full end-to-end user-incident pass is inferred from these tests.
