import { createFeed, setTable, type Feed } from "./model.js";

export interface StarterStopInput {
  stopId?: string;
  stopName: string;
  stopNameKana?: string;
  stopLat: string;
  stopLon: string;
}

export interface CreateGtfsJpV4StarterFeedOptions {
  agencyId?: string;
  agencyName: string;
  agencyUrl: string;
  agencyTimezone?: string;
  agencyLang?: string;
  routeId?: string;
  routeShortName?: string;
  routeLongName: string;
  tripId?: string;
  serviceId?: string;
  tripHeadsign?: string;
  feedPublisherName?: string;
  feedPublisherUrl?: string;
  feedLang?: string;
  feedStartDate: string;
  feedEndDate: string;
  feedVersion?: string;
  firstDepartureTime?: string;
  stopSpacingMinutes?: number;
  stops: StarterStopInput[];
}

/**
 * 新規作成用の最小GTFS-JP v4フィードを生成する。
 *
 * 固定路線バスMVPとして、agency/stops/routes/trips/stop_times/calendar/feed_info/
 * fare_attributes/translations を作る。詳細編集は生成後の通常画面で行う。
 */
export function createGtfsJpV4StarterFeed(options: CreateGtfsJpV4StarterFeedOptions): Feed {
  if (options.stops.length < 2) throw new Error("starter feed requires at least two stops");
  const feed = createFeed();
  const agencyId = cleanId(options.agencyId) || "agency";
  const routeId = cleanId(options.routeId) || "R1";
  const serviceId = cleanId(options.serviceId) || "weekday";
  const tripId = cleanId(options.tripId) || "T1";
  const firstDeparture = options.firstDepartureTime?.trim() || "07:00:00";
  const spacing = Math.max(1, Math.floor(options.stopSpacingMinutes ?? 5));
  const stops = options.stops.map((stop, index) => ({
    stop_id: cleanId(stop.stopId) || `S${index + 1}`,
    stop_name: stop.stopName.trim(),
    stop_lat: stop.stopLat.trim(),
    stop_lon: stop.stopLon.trim(),
    location_type: "0",
  }));

  setTable(
    feed,
    "agency",
    [
      {
        agency_id: agencyId,
        agency_name: options.agencyName.trim(),
        agency_url: options.agencyUrl.trim(),
        agency_timezone: options.agencyTimezone?.trim() || "Asia/Tokyo",
        agency_lang: options.agencyLang?.trim() || "ja",
      },
    ],
    ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"],
  );
  setTable(feed, "stops", stops, ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"]);
  setTable(
    feed,
    "routes",
    [
      {
        route_id: routeId,
        agency_id: agencyId,
        route_short_name: options.routeShortName?.trim() || "1",
        route_long_name: options.routeLongName.trim(),
        route_type: "3",
      },
    ],
    ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"],
  );
  setTable(
    feed,
    "trips",
    [
      {
        route_id: routeId,
        service_id: serviceId,
        trip_id: tripId,
        trip_headsign: options.tripHeadsign?.trim() || stops.at(-1)!.stop_name,
      },
    ],
    ["route_id", "service_id", "trip_id", "trip_headsign"],
  );
  setTable(
    feed,
    "stop_times",
    stops.map((stop, index) => {
      const time = addMinutesToHms(firstDeparture, index * spacing);
      return {
        trip_id: tripId,
        arrival_time: time,
        departure_time: time,
        stop_id: stop.stop_id,
        stop_sequence: String(index + 1),
      };
    }),
    ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
  );
  setTable(
    feed,
    "calendar",
    [
      {
        service_id: serviceId,
        monday: "1",
        tuesday: "1",
        wednesday: "1",
        thursday: "1",
        friday: "1",
        saturday: "0",
        sunday: "0",
        start_date: options.feedStartDate.trim(),
        end_date: options.feedEndDate.trim(),
      },
    ],
    [
      "service_id",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "start_date",
      "end_date",
    ],
  );
  setTable(
    feed,
    "feed_info",
    [
      {
        feed_publisher_name: options.feedPublisherName?.trim() || options.agencyName.trim(),
        feed_publisher_url: options.feedPublisherUrl?.trim() || options.agencyUrl.trim(),
        feed_lang: options.feedLang?.trim() || "ja",
        feed_start_date: options.feedStartDate.trim(),
        feed_end_date: options.feedEndDate.trim(),
        feed_version: options.feedVersion?.trim() || "starter-v1",
      },
    ],
    [
      "feed_publisher_name",
      "feed_publisher_url",
      "feed_lang",
      "feed_start_date",
      "feed_end_date",
      "feed_version",
    ],
  );
  setTable(
    feed,
    "fare_attributes",
    [
      {
        fare_id: "free",
        price: "0",
        currency_type: "JPY",
        payment_method: "0",
        transfers: "0",
      },
    ],
    ["fare_id", "price", "currency_type", "payment_method", "transfers"],
  );
  setTable(
    feed,
    "translations",
    stops.map((stop, index) => ({
      table_name: "stops",
      field_name: "stop_name",
      language: "ja-Hrkt",
      translation: options.stops[index]?.stopNameKana?.trim() || stop.stop_name,
      record_id: stop.stop_id,
    })),
    ["table_name", "field_name", "language", "translation", "record_id"],
  );

  return feed;
}

function cleanId(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, "_");
}

function addMinutesToHms(hms: string, minutes: number): string {
  const [h = "0", m = "0", s = "0"] = hms.split(":");
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s) + minutes * 60;
  const hour = Math.floor(total / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return [hour, minute, second].map((n) => String(n).padStart(2, "0")).join(":");
}
