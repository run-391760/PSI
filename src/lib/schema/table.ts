/** Idempotent table creation and additive upgrades for existing installations. */
export type Col = [name: string, def: string];

export function table(name: string, pk: Col[], cols: Col[], extra: string[] = []) {
  const all = [...pk, ...cols];
  const create = `CREATE TABLE IF NOT EXISTS ${name} (\n  ${all.map(([n, d]) => `${n} ${d}`).join(",\n  ")}\n);`;
  const alters = cols.map(([n, d]) => {
    const safe = /DEFAULT/i.test(d) ? d : d.replace(/\s+NOT NULL/i, "");
    return `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${n} ${safe};`;
  });
  return [create, ...alters, ...extra].join("\n");
}

