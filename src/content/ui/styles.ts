/** Styles for the shadow root that hosts the badge, card and toast. */
export const OVERLAY_CSS = `
:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

:host {
  --pl-bg: #ffffff;
  --pl-fg: #18181b;
  --pl-muted: #71717a;
  --pl-line: #e4e4e7;
  --pl-accent: #4f46e5;
  --pl-accent-fg: #ffffff;
  --pl-hover: #f4f4f5;
  --pl-shadow: 0 10px 38px rgba(24, 24, 27, 0.18), 0 2px 8px rgba(24, 24, 27, 0.10);
}

@media (prefers-color-scheme: dark) {
  :host {
    --pl-bg: #1c1c1f;
    --pl-fg: #f4f4f5;
    --pl-muted: #a1a1aa;
    --pl-line: #35353a;
    --pl-accent: #818cf8;
    --pl-accent-fg: #1c1c1f;
    --pl-hover: #27272b;
    --pl-shadow: 0 10px 38px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
  }
}

.badge {
  position: fixed;
  z-index: 2147483001;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--pl-line);
  border-radius: 999px;
  background: var(--pl-bg);
  color: var(--pl-muted);
  box-shadow: 0 2px 10px rgba(24, 24, 27, 0.16);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: transform 120ms ease, opacity 120ms ease;
}
.badge:hover { transform: scale(1.06); }
.badge[data-state="issues"] { color: #dc2626; border-color: #fecaca; }
.badge[data-state="clean"] { color: #16a34a; border-color: #bbf7d0; }
.badge[data-state="busy"] { color: var(--pl-accent); }
.badge[data-state="error"] { color: #b45309; border-color: #fde68a; }
.badge .mark { font-size: 13px; font-weight: 700; }

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.card {
  position: fixed;
  z-index: 2147483002;
  display: none;
  flex-direction: column;
  width: 340px;
  max-width: calc(100vw - 24px);
  border: 1px solid var(--pl-line);
  border-radius: 12px;
  background: var(--pl-bg);
  color: var(--pl-fg);
  box-shadow: var(--pl-shadow);
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--pl-muted);
}
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

.counter { margin-left: auto; font-size: 11px; color: var(--pl-muted); font-variant-numeric: tabular-nums; }

.message { padding: 6px 12px 0; font-weight: 600; }

.diff {
  margin: 10px 12px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--pl-hover);
  font-size: 13px;
  word-break: break-word;
}
.diff del { color: var(--pl-muted); text-decoration: line-through; text-decoration-thickness: 1px; }
.diff ins { color: #15803d; text-decoration: none; font-weight: 600; }
@media (prefers-color-scheme: dark) { .diff ins { color: #4ade80; } }
.diff .arrow { color: var(--pl-muted); margin: 0 6px; }

.explanation {
  margin: 8px 12px 0;
  color: var(--pl-muted);
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 12px;
  flex-wrap: wrap;
}

button {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--pl-line);
  border-radius: 7px;
  padding: 5px 10px;
  background: var(--pl-bg);
  color: var(--pl-fg);
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: var(--pl-hover); }
button.primary {
  background: var(--pl-accent);
  border-color: var(--pl-accent);
  color: var(--pl-accent-fg);
  font-weight: 600;
}
button.primary:hover { filter: brightness(1.08); }
button.ghost { border-color: transparent; color: var(--pl-muted); padding: 5px 6px; }
button.ghost:hover { color: var(--pl-fg); }
button:disabled { opacity: 0.5; cursor: default; }

.nav { margin-left: auto; display: flex; gap: 2px; }

/* Expanded by the card's own Expand button, for long results. */
.card.expanded { width: min(720px, calc(100vw - 24px)); }
.card.expanded .result-body { max-height: min(70vh, 620px); }

.result-body {
  margin: 8px 12px 0;
  max-height: 240px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  border-left: 2px solid var(--pl-line);
  padding-left: 10px;
}

.toast {
  position: fixed;
  z-index: 2147483003;
  display: none;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--pl-fg);
  color: var(--pl-bg);
  font-size: 12px;
  box-shadow: var(--pl-shadow);
  max-width: 320px;
}
`;
