"use client";

import { useState, type FormEvent } from "react";
import { CATEGORIES, CONDITIONS, LIMITS, type Category, type Condition } from "@/convex/lib/validators";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/format";
import { Button } from "./ui";

export type ToolInput = {
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const EMPTY: ToolInput = { name: "", category: "power_tools", condition: "good", description: "" };

const inputClass =
  "mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none";

export function ToolForm({
  initial = EMPTY,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: ToolInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: ToolInput) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<ToolInput>(initial);
  const set = <K extends keyof ToolInput>(key: K, value: ToolInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const remaining = LIMITS.descriptionMax - values.description.length;
  const valid = values.name.trim().length >= 2 && remaining >= 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Name
        <input
          className={inputClass}
          value={values.name}
          maxLength={LIMITS.toolNameMax}
          required
          placeholder="e.g. Cordless drill"
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Category
          <select
            className={inputClass}
            value={values.category}
            onChange={(e) => set("category", e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Condition
          <select
            className={inputClass}
            value={values.condition}
            onChange={(e) => set("condition", e.target.value as Condition)}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Short description
        <textarea
          className={`${inputClass} min-h-24`}
          value={values.description}
          placeholder="Anything a borrower should know — accessories, quirks, pickup notes."
          onChange={(e) => set("description", e.target.value)}
        />
        <span className={`mt-1 block text-xs ${remaining < 0 ? "text-red-600" : "text-stone-500"}`}>
          {remaining} characters left
        </span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" pending={pending} disabled={!valid}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
