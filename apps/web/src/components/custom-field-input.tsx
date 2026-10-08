import { Field, Input, Select } from '@/components/ui';
import type { CustomFieldDef, CustomFieldValue } from '@/lib/types';

const name = (key: string) => `cf:${key}`;

/** Renders one custom field as a form control named `cf:<key>`. */
export function CustomFieldInput({ def, value, error }: { def: CustomFieldDef; value?: CustomFieldValue; error?: string }) {
  const id = `cf-${def.key}`;
  const label = def.required ? `${def.label} *` : def.label;
  const common = { id, name: name(def.key), invalid: !!error };

  let control;
  switch (def.type) {
    case 'boolean':
      control = (
        <Select id={id} name={name(def.key)} defaultValue={value === undefined ? '' : String(value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
      break;
    case 'select':
      control = (
        <Select id={id} name={name(def.key)} defaultValue={(value as string) ?? ''}>
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
      break;
    case 'multi_select':
      control = (
        <div className="flex flex-wrap gap-3 pt-1" role="group" aria-labelledby={`${id}-label`}>
          {def.options?.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={name(def.key)} value={o} defaultChecked={Array.isArray(value) && value.includes(o)} />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    case 'long_text':
      control = (
        <textarea
          id={id}
          name={name(def.key)}
          rows={3}
          defaultValue={(value as string) ?? ''}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      );
      break;
    case 'number':
    case 'decimal':
      control = <Input {...common} type="number" step={def.type === 'number' ? 1 : 'any'} defaultValue={(value as number) ?? ''} />;
      break;
    case 'date':
      control = <Input {...common} type="date" defaultValue={(value as string) ?? ''} />;
      break;
    case 'datetime':
      control = <Input {...common} type="datetime-local" defaultValue={value ? String(value).slice(0, 16) : ''} />;
      break;
    default:
      control = <Input {...common} type={def.type === 'url' ? 'url' : def.type === 'email' ? 'email' : def.type === 'phone' ? 'tel' : 'text'} defaultValue={(value as string) ?? ''} />;
  }

  return (
    <Field label={label} htmlFor={id} error={error}>
      {control}
    </Field>
  );
}

/**
 * Reads `cf:*` controls into `{ key: value }`. Empty inputs become null when editing (clear) and are
 * omitted when creating.
 */
export function readCustomFields(form: FormData, defs: CustomFieldDef[], editing: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const key = name(def.key);
    let value: unknown;
    if (def.type === 'multi_select') {
      const all = form.getAll(key).map(String);
      value = all.length ? all : null;
    } else {
      const raw = String(form.get(key) ?? '').trim();
      if (!raw) value = null;
      else if (def.type === 'number' || def.type === 'decimal') value = Number(raw);
      else if (def.type === 'boolean') value = raw === 'true';
      else if (def.type === 'datetime') value = new Date(raw).toISOString();
      else value = raw;
    }
    if (value !== null || editing) out[def.key] = value;
  }
  return out;
}

export function formatCustomValue(def: CustomFieldDef, value: CustomFieldValue | undefined): string | null {
  if (value === undefined) return null;
  if (def.type === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
