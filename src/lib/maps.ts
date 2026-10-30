export function googleMapsUrl(location: string) {
  const address = location.trim();
  const query = /toulouse|图卢兹/i.test(address) ? address : `${address}, Toulouse, France`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
