import assert from "node:assert/strict";
import test from "node:test";
import { PLACES, getPlacePhotos } from "../src/lib/places";
import { DATES } from "../src/lib/types";

test("every listed attraction has 4–8 distinct sourced photos and all three opening records", () => {
  assert.equal(new Set(PLACES.map(place => place.id)).size, PLACES.length);
  assert.ok(PLACES.length >= 20);
  for (const place of PLACES) {
    const photos = getPlacePhotos(place);
    assert.ok(photos.length >= 4 && photos.length <= 8, `${place.id}: ${photos.length} photos`);
    assert.equal(new Set(photos.map(photo => photo.sourceUrl)).size, photos.length, place.id);
    assert.ok(place.description?.trim() && place.address.trim(), place.id);
    for (const date of DATES) assert.ok(place.hoursByDate[date]?.trim(), `${place.id}: ${date}`);
    for (const photo of photos) {
      const url = new URL(photo.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "thumb.wikimedia.org");
      assert.ok(url.pathname.startsWith("/wikipedia/commons/thumb/"));
      assert.ok(photo.alt && photo.credit && photo.sourceUrl && photo.license && photo.licenseUrl, place.id);
      assert.ok(photo.width > 0 && photo.height > 0, place.id);
    }
  }
});
