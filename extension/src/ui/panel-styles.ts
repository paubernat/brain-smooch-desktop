// Styles for the label panel (scoped inside its Shadow DOM).
export const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  width: 260px; box-sizing: border-box;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e5e7eb; background: rgba(17, 24, 39, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  opacity: 0.55; transition: opacity 0.15s;
}
.panel:hover, .panel:focus-within, .panel.busy { opacity: 1; }
.panel.hidden { display: none; }
.head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; user-select: none; }
.brand { font-weight: 700; letter-spacing: 0.04em; color: #9ca3af; }
.levels { display: flex; gap: 4px; flex: 1; }
.lvl { padding: 0 4px; border-radius: 4px; background: #374151; color: #9ca3af; font-size: 11px; }
.lvl.ok { background: #14532d; color: #bbf7d0; }
.lvl.pending { background: #713f12; color: #fde68a; }
.lvl.bad { background: #7f1d1d; color: #fecaca; }
.current { font-weight: 700; font-size: 11px; }
.body { padding: 0 8px 8px; }
.panel.collapsed .body { display: none; }
.title { color: #d1d5db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
.buttons { display: flex; gap: 4px; margin-bottom: 6px; }
button {
  flex: 1; font: inherit; font-weight: 700; padding: 6px 0; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; color: #f9fafb; background: #374151;
}
button:disabled { opacity: 0.4; cursor: default; }
button.NO { background: #991b1b; }
button.LIMITADO { background: #92400e; }
button.LIBRE { background: #166534; }
button.selected { border-color: #f9fafb; box-shadow: 0 0 0 1px #f9fafb inset; }
button.icon { flex: none; padding: 0 4px; background: none; color: #9ca3af; font-weight: 400; font-size: 13px; line-height: 1; }
button.icon:hover { color: #f9fafb; }
button.link { flex: none; background: none; border: none; padding: 0; color: #93c5fd; font-weight: 400; text-decoration: underline; }
input {
  width: 100%; box-sizing: border-box; font: inherit; padding: 4px 6px; margin-bottom: 6px;
  color: #f9fafb; background: #1f2937; border: 1px solid #4b5563; border-radius: 6px;
}
.status { color: #9ca3af; min-height: 1.4em; display: flex; gap: 6px; align-items: center; }
.status.error { color: #fca5a5; }
.status.ok { color: #86efac; }
.hint { color: #6b7280; font-size: 10px; }
.NO-text { color: #fca5a5; } .LIMITADO-text { color: #fcd34d; } .LIBRE-text { color: #86efac; }
`;
