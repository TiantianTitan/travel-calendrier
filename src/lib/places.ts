import { EXTRA_PLACES } from "./places-extra";
import { MORE_PLACES } from "./places-more";
import { PLACE_GALLERIES } from "./places-gallery";
import type { Category, TripDate } from "./types";

export interface PlaceImage {
  url: string;
  alt: string;
  credit: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  width: number;
  height: number;
}

export interface Place {
  id: string;
  /** Official French name, useful for map searches. */
  name: string;
  shortName: string;
  category: Category;
  address: string;
  locationQuery: string;
  /** Verified names only; never fragments of a route or a surrounding area. */
  aliases?: readonly string[];
  hours: string;
  hoursByDate: Record<TripDate, string>;
  closedDates: readonly TripDate[];
  hoursNote: string;
  hoursUrl: string;
  officialUrl: string;
  imageUrl: string;
  imageAlt: string;
  imageCredit: string;
  imageSourceUrl: string;
  imageLicense: string;
  imageLicenseUrl: string;
  imageWidth: number;
  imageHeight: number;
  verifiedAt: string;
  description?: string;
  highlights?: readonly string[];
  gallery?: readonly PlaceImage[];
}

/** Official schedules checked on 2026-10-30; times are local to Toulouse. */
const PLACE_CATALOG: readonly Place[] = [
  {
    id: "cite-espace",
    description: "以航天探索为主题的科学园区，可看 Ariane 5 火箭、Mir 空间站舱段与月球岩石，也有 IMAX 和天文馆展映。",
    highlights: ["火箭与空间站", "月球岩石", "天文馆"],
    name: "Cité de l’espace",
    shortName: "太空城",
    category: "explore",
    address: "Avenue Jean Gonord, 31500 Toulouse",
    locationQuery: "Cité de l’espace, Avenue Jean Gonord, 31500 Toulouse, France",
    hours: "10/31、11/1 10:00–18:00 · 11/2 闭馆",
    hoursByDate: {
      "2026-10-31": "10:00–18:00",
      "2026-11-01": "10:00–18:00",
      "2026-11-02": "周一闭馆",
    },
    closedDates: ["2026-11-02"],
    hoursNote: "展映和体验需另看场次。",
    hoursUrl: "https://www.handi.toulouse-tourisme.com/offre/cite-de-lespace/",
    officialUrl: "https://www.cite-espace.com/",
    imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/Cit%C3%A9_de_l%27espace_Toulouse_1.jpg/960px-Cit%C3%A9_de_l%27espace_Toulouse_1.jpg",
    imageAlt: "图卢兹太空城与 Ariane 5 火箭实景",
    imageCredit: "kallerna / Wikimedia Commons",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Cit%C3%A9_de_l%27espace_Toulouse_1.jpg",
    imageLicense: "CC BY-SA 4.0",
    imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 960,
    imageHeight: 648,
    gallery: [
      {
        url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Mus%C3%A9e_de_la_Cit%C3%A9_de_l%27Espace_02.jpg/960px-Mus%C3%A9e_de_la_Cit%C3%A9_de_l%27Espace_02.jpg",
        alt: "图卢兹太空城内供宇航员训练使用的 Mir 空间站舱段",
        credit: "Celeda / Wikimedia Commons",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Mus%C3%A9e_de_la_Cit%C3%A9_de_l%27Espace_02.jpg",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        width: 960,
        height: 720,
      },
    ],
    verifiedAt: "2026-10-30",
  },
  {
    id: "halle-machine",
    description: "展示大型机械装置与现场操演的场馆。巨型机械牛头人会在场外行走，乘坐体验与馆内参观分别安排场次。",
    highlights: ["机械牛头人", "现场操演", "大型机械装置"],
    name: "Halle de La Machine",
    shortName: "机械馆",
    category: "explore",
    address: "3 avenue de l’Aérodrome de Montaudran, 31400 Toulouse",
    locationQuery: "Halle de La Machine, 3 avenue de l’Aérodrome de Montaudran, 31400 Toulouse, France",
    aliases: ["La Halle de La Machine"],
    hours: "10/31、11/1 10:00–18:00 · 11/2 闭馆",
    hoursByDate: {
      "2026-10-31": "10:00–18:00，17:00 停止入场",
      "2026-11-01": "10:00–18:00，17:00 停止入场",
      "2026-11-02": "周一闭馆",
    },
    closedDates: ["2026-11-02"],
    hoursNote: "牛头人乘坐需另看场次；自驾入口：6 rue Jacqueline Auriol。",
    hoursUrl: "https://www.handi.toulouse-tourisme.com/offre/la-halle-de-la-machine/",
    officialUrl: "https://www.halledelamachine.fr/infos-pratiques/",
    imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/74/Minotaure.jpg/960px-Minotaure.jpg",
    imageAlt: "图卢兹机械馆的巨型机械牛头人实景",
    imageCredit: "Frédéric Neupont / Wikimedia Commons",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Minotaure.jpg",
    imageLicense: "CC BY-SA 4.0",
    imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 960,
    imageHeight: 675,
    gallery: [
      {
        url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/Piste_des_G%C3%A9ants_et_halle_de_la_Machine.jpg/960px-Piste_des_G%C3%A9ants_et_halle_de_la_Machine.jpg",
        alt: "图卢兹机械馆与 Piste des Géants 步行区",
        credit: "Abdoucondorcet / Wikimedia Commons",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Piste_des_G%C3%A9ants_et_halle_de_la_Machine.jpg",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        width: 960,
        height: 720,
      },
    ],
    verifiedAt: "2026-10-30",
  },
  {
    id: "jardin-japonais",
    description: "位于 Compans-Caffarelli 公园内，以京都庭园为灵感。红桥、池塘、茶亭与枯山水集中在步行可达的小型园区。",
    highlights: ["红桥", "池塘", "枯山水"],
    name: "Jardin japonais Pierre-Baudis",
    shortName: "日式花园",
    category: "rest",
    address: "9 boulevard Lascrosses, 31000 Toulouse",
    locationQuery: "Jardin japonais Pierre-Baudis, 9 boulevard Lascrosses, 31000 Toulouse, France",
    aliases: ["Jardin japonais", "Jardin japonais Pierre Baudis"],
    hours: "10/31 08:00–20:00 · 11/1–2 08:00–18:00",
    hoursByDate: {
      "2026-10-31": "08:00–20:00（季节常规开放时间）",
      "2026-11-01": "08:00–18:00（季节常规开放时间）",
      "2026-11-02": "08:00–18:00（季节常规开放时间）",
    },
    closedDates: [],
    hoursNote: "茶亭暂不开放；大风等天气可能临时闭园。",
    hoursUrl: "https://metropole.toulouse.fr/annuaire/jardin-japonais-pierre-baudis",
    officialUrl: "https://metropole.toulouse.fr/annuaire/jardin-japonais-pierre-baudis",
    imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Toulouse_-_Vue_du_jardin_japonais.jpg/960px-Toulouse_-_Vue_du_jardin_japonais.jpg",
    imageAlt: "图卢兹 Pierre-Baudis 日式花园实景",
    imageCredit: "Pixou31 / Wikimedia Commons",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Toulouse_-_Vue_du_jardin_japonais.jpg",
    imageLicense: "CC BY-SA 3.0",
    imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    imageWidth: 960,
    imageHeight: 720,
    gallery: [
      {
        url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Jardin_sec_%28%E6%9E%AF%E5%B1%B1%E6%B0%B4karesansui%29_du_jardin_japonais_de_Toulouse.jpg/960px-Jardin_sec_%28%E6%9E%AF%E5%B1%B1%E6%B0%B4karesansui%29_du_jardin_japonais_de_Toulouse.jpg",
        alt: "图卢兹日式花园内的枯山水庭园",
        credit: "Antoninmorvan / Wikimedia Commons",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Jardin_sec_(%E6%9E%AF%E5%B1%B1%E6%B0%B4karesansui)_du_jardin_japonais_de_Toulouse.jpg",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        width: 960,
        height: 636,
      },
    ],
    verifiedAt: "2026-10-30",
  },
  {
    id: "saint-sernin",
    description: "建于中世纪的罗曼式教堂，是圣地亚哥朝圣之路的一部分。八角钟楼、雕刻门廊与教堂内部均可参观，地下墓室另有开放时段。",
    highlights: ["八角钟楼", "雕刻门廊", "罗曼式建筑"],
    name: "Basilique Saint-Sernin",
    shortName: "圣塞尔南教堂",
    category: "explore",
    address: "Place Saint-Sernin, 31000 Toulouse",
    locationQuery: "Basilique Saint-Sernin, Place Saint-Sernin, 31000 Toulouse, France",
    hours: "三天常规开放 08:30–18:00 · 礼拜时暂停参观",
    hoursByDate: {
      "2026-10-31": "08:30–18:00（礼拜期间暂停参观）",
      "2026-11-01": "常规 08:30–18:00；节日礼拜时段待当日确认",
      "2026-11-02": "08:30–18:00（礼拜期间暂停参观）",
    },
    closedDates: [],
    hoursNote: "礼拜期间暂停参观；地下墓室另有时段，11/1 具体安排待确认。",
    hoursUrl: "https://www.handi.toulouse-tourisme.com/offre/la-basilique-saint-sernin/",
    officialUrl: "https://metropole.toulouse.fr/annuaire/basilique-saint-sernin",
    imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/Ext%C3%A9rieur_de_la_Basilique_Saint-Sernin.jpg/960px-Ext%C3%A9rieur_de_la_Basilique_Saint-Sernin.jpg",
    imageAlt: "图卢兹圣塞尔南教堂外观实景",
    imageCredit: "Don-vip / Wikimedia Commons",
    imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Ext%C3%A9rieur_de_la_Basilique_Saint-Sernin.jpg",
    imageLicense: "CC BY-SA 3.0",
    imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    imageWidth: 960,
    imageHeight: 625,
    gallery: [
      {
        url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/St_Sernin%2Cint%C3%A9rieur12%2Cnef12%2Cstalles_sud1.jpg/960px-St_Sernin%2Cint%C3%A9rieur12%2Cnef12%2Cstalles_sud1.jpg",
        alt: "图卢兹圣塞尔南教堂内部中殿",
        credit: "Finoskov / Wikimedia Commons",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:St_Sernin,int%C3%A9rieur12,nef12,stalles_sud1.jpg",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        width: 960,
        height: 768,
      },
    ],
    verifiedAt: "2026-10-30",
  },
  ...EXTRA_PLACES,
  ...MORE_PLACES,
];

export const PLACES: readonly Place[] = PLACE_CATALOG.map(place => ({ ...place, gallery: [...(place.gallery ?? []), ...(PLACE_GALLERIES[place.id] ?? [])] }));

export function getPlacePhotos(place: Place): PlaceImage[] {
  const cover: PlaceImage = { url: place.imageUrl, alt: place.imageAlt, credit: place.imageCredit, sourceUrl: place.imageSourceUrl, license: place.imageLicense, licenseUrl: place.imageLicenseUrl, width: place.imageWidth, height: place.imageHeight };
  return [cover, ...(place.gallery ?? [])].filter((photo, index, all) => all.findIndex(other => other.sourceUrl === photo.sourceUrl || other.url === photo.url) === index).slice(0, 8);
}

function normalizeLocation(location: string): string {
  return location.normalize("NFC")
    .replace(/[‘’ʼ＇]/gu, "'")
    .replace(/[‐‑‒–—―−﹣－]/gu, "-")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\s*([,'-])\s*/gu, "$1");
}

/** Match a single known place, never a substring of a route or a nearby venue. */
export function findPlaceByLocation(location: string): Place | undefined {
  const normalized = normalizeLocation(location);
  if (!normalized) return undefined;
  return PLACES.find((place) => [place.name, place.address, place.locationQuery, ...(place.aliases ?? [])]
    .some((candidate) => normalizeLocation(candidate) === normalized));
}
