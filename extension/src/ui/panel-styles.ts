// Styles for the label panel (scoped inside its Shadow DOM).
//
// Layout rules that keep every control inside the 260px panel whatever the
// level states, label or font size: flex/grid children get `min-width: 0` so
// they can shrink, the three label buttons are an equal-width grid that never
// overflows, and long texts are ellipsized instead of pushing siblings out.
export const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 260px; max-width: calc(100vw - 32px); box-sizing: border-box; overflow: hidden;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e5e7eb; background: rgba(17, 24, 39, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  opacity: 0.55; transition: opacity 0.15s;
}
.panel *, .panel *::before, .panel *::after { box-sizing: border-box; }
.panel:hover, .panel:focus-within, .panel.busy { opacity: 1; }
.panel.hidden { display: none; }
.head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; user-select: none; min-width: 0; }
.brand { flex: none; font-weight: 700; letter-spacing: 0.04em; color: #9ca3af; }
.levels { display: flex; gap: 3px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.lvl { flex: none; padding: 0 4px; border-radius: 4px; background: #374151; color: #9ca3af; font-size: 11px; white-space: nowrap; }
.lvl.ok { background: #14532d; color: #bbf7d0; }
.lvl.pending { background: #713f12; color: #fde68a; }
.lvl.bad { background: #7f1d1d; color: #fecaca; }
.current { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; font-size: 11px; }
.panel:not(.collapsed) .current { display: none; } /* the selected button shows it */
.body { padding: 0 8px 8px; }
.panel.collapsed .body { display: none; }
.title { color: #d1d5db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
.buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-bottom: 6px; }
button {
  font: inherit; color: #f9fafb; cursor: pointer; margin: 0;
  border: 1px solid transparent; border-radius: 6px; background: #374151;
}
button.label {
  min-width: 0; padding: 6px 2px; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.panel.waiting button.label { opacity: 0.6; }
button.NO { background: #991b1b; }
button.LIMITADO { background: #92400e; }
button.LIBRE { background: #166534; }
button.label:hover { filter: brightness(1.15); }
button.label:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
button.selected { border-color: #f9fafb; box-shadow: 0 0 0 1px #f9fafb inset; }
button.icon { flex: none; padding: 0 4px; background: none; color: #9ca3af; font-weight: 400; font-size: 13px; line-height: 1; }
button.icon:hover { color: #f9fafb; }
button.badge {
  flex: none; padding: 0 6px; border-radius: 999px; background: #4338ca; color: #e0e7ff;
  font-size: 10px; font-weight: 700; line-height: 16px;
}
button.link { flex: none; background: none; border: none; padding: 0; color: #93c5fd; font-weight: 400; text-decoration: underline; }
button.calibrate { display: block; margin: 0 0 4px; font-size: 11px; }
.hidden { display: none !important; }
input {
  width: 100%; font: inherit; padding: 4px 6px; margin: 0 0 6px;
  color: #f9fafb; background: #1f2937; border: 1px solid #4b5563; border-radius: 6px;
}
.status { color: #9ca3af; min-height: 1.4em; display: flex; gap: 6px; align-items: center; min-width: 0; overflow-wrap: anywhere; }
.status.error { color: #fca5a5; }
.status.ok { color: #86efac; }
.hint { color: #6b7280; font-size: 10px; }
.NO-text { color: #fca5a5; } .LIMITADO-text { color: #fcd34d; } .LIBRE-text { color: #86efac; }
`;
