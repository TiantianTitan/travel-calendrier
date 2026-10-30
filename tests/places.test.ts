import assert from "node:assert/strict";
import { test } from "node:test";
import { findPlaceByLocation, PLACES } from "../src/lib/places";

test("known places match their complete name, address, and saved location query", () => {
  for (const place of PLACES) {
    for (const location of [place.name, place.address, place.locationQuery]) {
      assert.equal(findPlaceByLocation(location)?.id, place.id, location);
    }
  }
});

test("place matching normalizes equivalent Unicode, quotes, hyphens, case, and whitespace", () => {
  assert.equal(findPlaceByLocation("  CITE\u0301  DE L’ESPACE\n")?.id, "cite-espace");
  assert.equal(findPlaceByLocation("3 AVENUE DE L'AÉRODROME DE MONTAUDRAN,31400\tTOULOUSE")?.id, "halle-machine");
  assert.equal(findPlaceByLocation("Jardin japonais Pierre ‑ Baudis")?.id, "jardin-japonais");
  assert.equal(findPlaceByLocation("BASILIQUE SAINT–SERNIN")?.id, "saint-sernin");
});

test("only explicit verified aliases identify a place", () => {
  assert.equal(findPlaceByLocation("La Halle de La Machine")?.id, "halle-machine");
  assert.equal(findPlaceByLocation("Jardin Japonais")?.id, "jardin-japonais");
  assert.equal(findPlaceByLocation("Jardin japonais Pierre Baudis")?.id, "jardin-japonais");
  assert.equal(findPlaceByLocation("Saint-Sernin"), undefined);
  assert.equal(findPlaceByLocation("Cite de l'espace"), undefined);
});

test("routes, nearby venues, incomplete addresses, and blanks never inherit a single place's hours", () => {
  for (const location of [
    "Jardin Japonais · 运河",
    "Capitole → Saint-Sernin → Pont Neuf",
    "Cité de l’espace → Halle de La Machine",
    "Halle de La Machine / Jardin japonais",
    "Café près de la Cité de l’espace",
    "Avenue Jean Gonord",
    "9 boulevard Lascrosses, Paris",
    "", " \n\t",
  ]) assert.equal(findPlaceByLocation(location), undefined, location);
});
