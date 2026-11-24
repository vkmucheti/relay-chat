export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0].toUpperCase())
      .join('') || 'R'
  );
}
export function tone(id: string) {
  return Number.parseInt(id.slice(-2), 16) % 6 || 0;
}
