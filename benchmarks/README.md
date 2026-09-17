# Measurement status and protocol

No real-model inference latency, process memory, accuracy, or browser-wide
network results have been collected yet. Do not substitute E2E fixture timings
or synthetic spelling responses for these measurements.

`writing-errors.json` is a hand-authored English smoke dataset: eight sentences
with errors and four clean controls. It is deliberately small and is not a
representative accuracy benchmark. Freeze it before running and report every
prediction, including missed errors and suggestions on clean text.

## Reproduce on a supported Chrome device

1. Install the unmodified release build, download the models through Settings,
   then record OS, CPU, RAM, GPU/VRAM, Chrome version, extension commit, enabled
   flags, available APIs, language, categories, and writing goals.
2. Run each dataset sentence through the actual extension. Save the input,
   all suggested spans/replacements, and the diagnostics timings. Manually
   adjudicate equivalent valid corrections and publish those decisions.
3. Report precision (correct suggested corrections / all suggested corrections),
   recall (expected errors corrected / eight expected errors), and clean-control
   false-positive rate (clean sentences receiving a suggestion / four).
   Report raw counts as well as ratios. Treat style-only advice separately.
4. Collect at least 30 uncached passes using fixed recorded inputs. Reset the
   extension between cold runs. Report the first-run latency separately from
   the median and p95 warm-session latency. Pilcrow caches sentences: report
   `reuse.cached` and `reuse.prompted`, and do not call a cache hit inference.
   Use `AnalysisResult.timings.model` for the model stage and `elapsedMs` for
   total engine time; separately time click-to-visible-result for UI latency.
5. In Chrome Task Manager, enable process IDs and memory footprint. Record the
   extension/offscreen and model process footprints at baseline, after warm-up,
   and peak during the same workload. State whether GPU memory is included.
   JS heap size alone does not describe model memory.
6. After model download, disconnect the OS network and repeat the workload in
   a local editor. Record a screen capture of successful real-model corrections.
   In a separate online run, capture Chrome net-export from an isolated profile
   with Sync disabled and no other extensions; inspect browser/model traffic as
   well as page requests. Report hostnames, bytes, observation duration, and
   capture scope. Never publish an unsanitized net-export containing credentials.

## What the automated offline test proves

The E2E test turns Playwright networking off after loading a local fixture and
accepts a correction through the real content script, messaging, controller and
UI, with a deterministic engine double. It asserts zero subsequent **page**
requests. This demonstrates UI/transport behavior without a page-network
connection. It does not measure Gemini Nano inference or rule out traffic from
Chrome, Sync, service workers, or model processes.

## Results

| Measurement | Status |
| --- | --- |
| Real-model median/p95 inference latency | Not measured |
| Extension + model process memory | Not measured |
| Small-dataset precision/recall | Not measured |
| OS-offline real inference | Not verified |
| Browser-wide network capture | Not collected |

Attach raw results, environment details and the exact commit before filling in
this table or quoting numbers in a CV.
