import { useState } from "react";

const SWATCHES = [
  "#e5e7eb",
  "#b9bec7",
  "#6b7280",
  "#1f2937",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#facc15",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

/** Compact colour picker: live swatch, native picker, hex field and presets. */
export default function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);

  const commit = (hex: string) => {
    setText(hex);
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] underline-offset-2 hover:underline cursor-pointer"
        >
          {open ? "Hide" : "Presets"}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <label
          className="size-7 shrink-0 cursor-pointer rounded border border-border"
          style={{ backgroundColor: text }}
        >
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(text) ? text : "#ffffff"}
            onChange={(e) => commit(e.target.value)}
            className="size-0 opacity-0"
          />
        </label>
        <input
          value={text}
          onChange={(e) => commit(e.target.value.trim())}
          spellCheck={false}
          className="w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] outline-none focus:border-primary text-foreground"
        />
      </div>

      {open && (
        <div className="grid grid-cols-8 gap-1 rounded border border-border bg-secondary p-1.5">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              title={s}
              onClick={() => commit(s)}
              className="aspect-square rounded-sm border border-black/20 transition-transform hover:scale-110 cursor-pointer"
              style={{ backgroundColor: s }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
