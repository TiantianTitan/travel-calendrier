"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Clock, ImageOff, MapPin, Plus, Search } from "lucide-react";
import { PLACES, getPlacePhotos, type Place, type PlaceImage } from "@/lib/places";
import { googleMapsUrl } from "@/lib/maps";
import { DATES, type TripDate } from "@/lib/types";
import { Sheet } from "./sheet";
import styles from "./places-strip.module.css";

function cover(place: Place): PlaceImage {
  return { url: place.imageUrl, alt: place.imageAlt, credit: place.imageCredit, sourceUrl: place.imageSourceUrl, license: place.imageLicense, licenseUrl: place.imageLicenseUrl, width: place.imageWidth, height: place.imageHeight };
}

function PlacePhoto({ photo, large = false, eager = false }: { photo: PlaceImage; large?: boolean; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<"loading" | "cached" | "loaded">("loading");
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    // A cached image must be visible on its first painted frame, without replaying a fade.
    setLoaded(image.current?.complete && image.current.naturalWidth > 0 ? "cached" : "loading");
  }, [photo.url]);
  return <span className={`place-photo ${large ? "place-photo-large" : ""}`} data-loaded={loaded !== "loading" || failed} data-fade={loaded === "loaded"}>{failed
    ? <ImageOff size={24} aria-hidden="true" />
    : <Image ref={image} loading={eager ? "eager" : "lazy"} src={photo.url} alt={photo.alt} fill sizes={large ? "(max-width: 799px) 100vw, 600px" : "(max-width: 799px) 170px, 240px"} onLoad={() => setLoaded(current => current === "cached" ? current : "loaded")} onError={() => setFailed(true)} />
  }</span>;
}

function PlaceCard({ place, date, onClick, eager = false }: { place: Place; date: TripDate; onClick: () => void; eager?: boolean }) {
  return <button className="place-card" data-place-id={place.id} onClick={onClick} aria-label={`查看${place.shortName}`}>
    <PlacePhoto photo={cover(place)} eager={eager} />
    <span className="place-caption"><strong>{place.shortName}</strong><ArrowUpRight size={14} /></span>
    <span className={`place-availability ${place.closedDates.includes(date) ? "is-closed" : ""}`}>{place.closedDates.includes(date) ? "当天闭馆" : ""}</span>
  </button>;
}

function PlaceGallery({ name, photos }: { name: string; photos: PlaceImage[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const visibleIndex = useRef(0);
  const requestedIndex = useRef<number | null>(null);
  const positions = useRef<number[]>([]);
  const scrollFrame = useRef<number | null>(null);
  const readPosition = useCallback(() => {
    const element = track.current;
    if (!element || !positions.current.length) return;
    const left = element.scrollLeft;
    const nearest = positions.current.reduce((best, position, i, values) => Math.abs(position - left) < Math.abs(values[best] - left) ? i : best, 0);
    if (nearest !== visibleIndex.current) { visibleIndex.current = nearest; setIndex(nearest); }
    const requested = requestedIndex.current;
    if (requested !== null) {
      const destination = Math.min(positions.current[requested], element.scrollWidth - element.clientWidth);
      if (Math.abs(destination - left) <= 1) requestedIndex.current = null;
    }
    if (requestedIndex.current === null) setNavigationIndex(current => current === nearest ? current : nearest);
  }, []);
  const queuePositionRead = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = null; readPosition(); });
  }, [readPosition]);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => {
      const children = Array.from(element.children) as HTMLElement[];
      const start = children[0]?.offsetLeft ?? 0;
      positions.current = children.map(child => child.offsetLeft - start);
      requestedIndex.current = null;
      readPosition();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finishWithoutMotion = () => {
      const target = requestedIndex.current;
      if (reducedMotion.matches && target !== null) {
        element.scrollTo({ left: positions.current[target], behavior: "instant" });
        queuePositionRead();
      }
    };
    reducedMotion.addEventListener("change", finishWithoutMotion);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", finishWithoutMotion);
      if (scrollFrame.current !== null) { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = null; }
    };
  }, [photos.length, queuePositionRead, readPosition]);
  const step = (direction: number) => {
    const element = track.current;
    if (!element || !positions.current.length) return;
    const target = Math.max(0, Math.min(photos.length - 1, (requestedIndex.current ?? visibleIndex.current) + direction));
    requestedIndex.current = target;
    setNavigationIndex(target);
    element.scrollTo({ left: positions.current[target], behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    queuePositionRead();
  };
  const takeOver = () => {
    const element = track.current;
    if (requestedIndex.current !== null && element) {
      requestedIndex.current = null;
      element.scrollTo({ left: element.scrollLeft, behavior: "instant" });
    }
    readPosition();
  };
  return <div className="place-gallery-wrap">
    <div ref={track} className="place-gallery" role="region" aria-label={`${name}照片`} tabIndex={0} onKeyDown={event => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); step(event.key === "ArrowRight" ? 1 : -1); }
      else if (["Home", "End", "PageUp", "PageDown"].includes(event.key)) takeOver();
    }} onPointerDown={takeOver} onWheel={takeOver} onScroll={queuePositionRead}>{photos.map((photo, i) => <figure key={photo.url} aria-label={`照片 ${i + 1}，共 ${photos.length} 张`}><PlacePhoto photo={photo} large eager={i === 0} /></figure>)}</div>
    {photos.length > 1 && <div className="place-gallery-controls"><button className="icon-button" aria-label="上一张照片" disabled={navigationIndex === 0} onClick={() => step(-1)}><ChevronLeft size={20} /></button><span aria-live="polite">{index + 1} / {photos.length}</span><button className="icon-button" aria-label="下一张照片" disabled={navigationIndex === photos.length - 1} onClick={() => step(1)}><ChevronRight size={20} /></button></div>}
  </div>;
}

function PlaceDetails({ place, initialDate, onCreate }: { place: Place; initialDate: TripDate; onCreate: (place: Place, date: TripDate) => void }) {
  const [date, setDate] = useState(initialDate);
  const photos = getPlacePhotos(place);
  return <>
    <PlaceGallery name={place.shortName} photos={photos} />
    {place.description && <p className="place-description">{place.description}</p>}
    {!!place.highlights?.length && <ul className="place-highlights">{place.highlights.map(item => <li key={item}>{item}</li>)}</ul>}
    <a className="place-address" href={googleMapsUrl(place.locationQuery)} target="_blank" rel="noreferrer"><MapPin size={17} /><span>{place.address}</span><ArrowUpRight size={16} /></a>
    <div className="place-opening">
      <div className="place-opening-header"><span><Clock size={16} />开放时间</span><select value={date} onChange={e => setDate(e.target.value as TripDate)} aria-label="查看日期">{DATES.map(day => <option key={day} value={day}>{day.slice(5).replace("-", "月")}日</option>)}</select></div>
      <p className={place.closedDates.includes(date) ? "closed-hours" : ""}>{place.hoursByDate[date]}</p>
      {place.hoursNote && <small>{place.hoursNote}</small>}
      <a href={place.hoursUrl} target="_blank" rel="noreferrer">官方时间<ArrowUpRight size={13} /></a>
    </div>
    <div className="place-source-row"><a href={place.officialUrl} target="_blank" rel="noreferrer">景点官网<ArrowUpRight size={13} /></a><details><summary>图片来源</summary><ul className="photo-credits">{photos.map(photo => <li key={photo.url}><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.credit}</a><a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></li>)}</ul><small>照片按显示比例裁切。</small></details></div>
    <div className="form-footer place-detail-footer"><button className="primary-button" onClick={() => onCreate(place, date)}><Plus size={17} />添加活动</button></div>
  </>;
}

type CatalogPosition = { top: number; placeId: string };
type PlaceBrowser = { kind: "catalog"; transition?: "back" } | { kind: "detail"; place: Place; fromCatalog: boolean; transition?: "forward" };

function PlaceBrowserView({ kind, transition, restore, children }: { kind: PlaceBrowser["kind"]; transition?: "forward" | "back"; restore?: CatalogPosition | null; children: ReactNode }) {
  const view = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!transition) return;
    const sheet = view.current?.closest<HTMLElement>("[data-travel-sheet]");
    if (!sheet || sheet.dataset.closing === "true") return;
    if (transition === "back" && restore) {
      sheet.scrollTo({ top: restore.top, behavior: "instant" });
      const card = Array.from(view.current!.querySelectorAll<HTMLButtonElement>("[data-place-id]")).find(node => node.dataset.placeId === restore.placeId);
      if (card) {
        const bounds = sheet.getBoundingClientRect();
        const item = card.getBoundingClientRect();
        const chrome = window.matchMedia("(max-width: 799px)").matches ? sheet.querySelector<HTMLElement>(".sheet-chrome") : null;
        const top = (chrome?.getBoundingClientRect().bottom ?? bounds.top + sheet.clientTop) + 12;
        const bottom = bounds.top + sheet.clientTop + sheet.clientHeight - 12;
        if (item.top < top) sheet.scrollTop += item.top - top;
        else if (item.bottom > bottom) sheet.scrollTop += item.bottom - bottom;
        card.focus({ preventScroll: true });
        return;
      }
    }
    sheet.scrollTo({ top: 0, behavior: "instant" });
    const title = sheet.querySelector<HTMLElement>(".sheet-header h2");
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }, [transition, restore]);
  return <div ref={view} className={styles.view} data-place-view={kind} data-transition={transition}>{children}</div>;
}

export function PlacesStrip({ date, onCreate }: { date: TripDate; onCreate: (place: Place, date: TripDate) => void }) {
  const [browser, setBrowser] = useState<PlaceBrowser | null>(null);
  const [query, setQuery] = useState("");
  const catalogGrid = useRef<HTMLDivElement>(null);
  const catalogPosition = useRef<CatalogPosition | null>(null);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = PLACES.filter(place => normalize(`${place.shortName} ${place.name} ${place.address}`).includes(normalize(query.trim())));
  const show = (place: Place, fromCatalog = false) => {
    if (fromCatalog) catalogPosition.current = { top: catalogGrid.current?.closest<HTMLElement>("[data-travel-sheet]")?.scrollTop ?? 0, placeId: place.id };
    setBrowser({ kind: "detail", place, fromCatalog, transition: fromCatalog ? "forward" : undefined });
  };
  return <section className="places-section" aria-label="图卢兹景点">
    <div className="places-heading"><h2>景点</h2><button onClick={() => setBrowser({ kind: "catalog" })}>全部 {PLACES.length}<ArrowRight size={13} /></button></div>
    <div className="places-track">{PLACES.slice(0, 4).map(place => <PlaceCard eager key={place.id} place={place} date={date} onClick={() => show(place)} />)}</div>
    {browser && <Sheet title={browser.kind === "catalog" ? "图卢兹景点" : browser.place.shortName} description={browser.kind === "detail" ? browser.place.name : undefined} onClose={() => setBrowser(null)} onBack={browser.kind === "detail" && browser.fromCatalog ? () => setBrowser({ kind: "catalog", transition: "back" }) : undefined} backLabel="返回景点目录" className={browser.kind === "catalog" ? "places-catalog-sheet" : "place-detail-sheet"}>
      <PlaceBrowserView key={browser.kind === "catalog" ? "catalog" : browser.place.id} kind={browser.kind} transition={browser.transition} restore={browser.kind === "catalog" ? catalogPosition.current : undefined}>
        {browser.kind === "catalog" ? <>
          <label className="place-search"><Search size={17} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索景点" aria-label="搜索景点" /></label>
          <div ref={catalogGrid} className="places-catalog-grid">{filtered.map(place => <PlaceCard key={place.id} place={place} date={date} onClick={() => show(place, true)} />)}</div>
          {!filtered.length && <p className="catalog-empty">没有找到景点</p>}
        </> : <PlaceDetails place={browser.place} initialDate={date} onCreate={(place, nextDate) => { setBrowser(null); onCreate(place, nextDate); }} />}
      </PlaceBrowserView>
    </Sheet>}
  </section>;
}
