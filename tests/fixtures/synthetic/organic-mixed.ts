// Только выдуманные координаты и названия, без данных путешественника.
export function organicMixed(nights = 12, organic = true, geometry: 'LineString' | 'gx:Track' = 'LineString'): string {
  const marks = Array.from({ length: nights }, (_, i) => `<Placemark><name>Camp ${i}</name><styleUrl>#${organic ? 'placemark-green' : 'green'}</styleUrl><TimeStamp><when>2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z</when></TimeStamp><Point><coordinates>${30 + i * 0.1},40</coordinates></Point></Placemark>`).join('\n');
  const line = geometry === 'LineString'
    ? '<LineString><coordinates>10,50,100 10.01,50,120</coordinates></LineString>'
    : '<gx:Track><when>2025-01-01T00:00:00Z</when><when>2025-01-01T00:10:00Z</when><gx:coord>10 50 100</gx:coord><gx:coord>10.01 50 120</gx:coord></gx:Track>';
  return `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Synthetic backup</name>${marks}<Placemark><name>Private walk</name>${line}</Placemark></Document></kml>`;
}
