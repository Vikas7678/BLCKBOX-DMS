/** Display date as DD/MM/YYYY */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Display date+time via locale string */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
