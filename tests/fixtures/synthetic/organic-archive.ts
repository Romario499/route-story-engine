// Synthetic archive: two collections and two bookmark-creation periods, never private data.
export function organicArchive(): string {
  const folder = (name: string, dates: string[], start: number) => `<Folder><name>${name}</name>${dates.map((date, i) => `<Placemark><name>${name}-${i}</name><styleUrl>#placemark-green</styleUrl><TimeStamp><when>${date}T12:00:00Z</when></TimeStamp><Point><coordinates>${start + i * 0.01},48</coordinates></Point></Placemark>`).join('')}</Folder>`;
  return `<kml><Document><name>Synthetic archive</name>${folder('Trip A', ['2025-01-01', '2025-01-02'], 2.3)}${folder('Trip B', ['2026-10-11', '2026-10-12'], 16.3)}</Document></kml>`;
}
