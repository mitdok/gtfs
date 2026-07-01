import { useMemo } from "react";
import { getRows, getTable, setTable, type Feed, type FeedTable } from "@gtfs-studio/core";
import { listRoutes } from "../lib/timetable";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

const FARE_ATTRIBUTE_COLUMNS = [
  "fare_id",
  "price",
  "currency_type",
  "payment_method",
  "transfers",
  "agency_id",
  "ic_price",
];
const FARE_RULE_COLUMNS = ["fare_id", "route_id", "origin_id", "destination_id", "contains_id"];
const ATTRIBUTION_COLUMNS = [
  "attribution_id",
  "organization_name",
  "is_producer",
  "is_operator",
  "is_authority",
  "attribution_url",
  "attribution_email",
  "attribution_phone",
];

function ensureTable(feed: Feed, name: string, columns: string[]): FeedTable {
  const existing = getTable(feed, name);
  if (existing) {
    for (const col of columns) {
      if (!existing.columns.includes(col)) existing.columns.push(col);
    }
    return existing;
  }
  setTable(feed, name, [], columns);
  return getTable(feed, name)!;
}

function nextId(rows: Record<string, string>[], key: string, prefix: string): string {
  const used = new Set(rows.map((row) => row[key] ?? ""));
  for (let n = rows.length + 1; n < rows.length + 10000; n += 1) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

export function FaresView({ feed, version, mutateFeed }: Props) {
  const fares = getRows(feed, "fare_attributes");
  const rules = getRows(feed, "fare_rules");
  const attributions = getRows(feed, "attributions");
  const routes = useMemo(() => listRoutes(feed), [feed, version]);
  const zones = useMemo(() => {
    const values = new Set<string>();
    for (const row of getRows(feed, "stops")) {
      const zone = (row["zone_id"] ?? "").trim();
      if (zone !== "") values.add(zone);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [feed, version]);

  const editFare = (fareId: string, field: string, value: string) => {
    mutateFeed((f) => {
      for (const row of getRows(f, "fare_attributes")) {
        if ((row["fare_id"] ?? "") === fareId) row[field] = value;
      }
    });
  };

  const addFare = () => {
    mutateFeed((f) => {
      const table = ensureTable(f, "fare_attributes", FARE_ATTRIBUTE_COLUMNS);
      const id = nextId(table.rows, "fare_id", "fare");
      table.rows.push({
        fare_id: id,
        price: "0",
        currency_type: "JPY",
        payment_method: "0",
        transfers: "",
        agency_id: "",
        ic_price: "",
      });
    });
  };

  const deleteFare = (fareId: string) => {
    mutateFeed((f) => {
      const fareTable = getTable(f, "fare_attributes");
      if (fareTable) fareTable.rows = fareTable.rows.filter((row) => (row["fare_id"] ?? "") !== fareId);

      const ruleTable = getTable(f, "fare_rules");
      if (ruleTable) ruleTable.rows = ruleTable.rows.filter((row) => (row["fare_id"] ?? "") !== fareId);
    });
  };

  const editRule = (index: number, field: string, value: string) => {
    mutateFeed((f) => {
      const row = getRows(f, "fare_rules")[index];
      if (row) row[field] = value;
    });
  };

  const addRule = (fareId = fares[0]?.["fare_id"] ?? "") => {
    mutateFeed((f) => {
      const table = ensureTable(f, "fare_rules", FARE_RULE_COLUMNS);
      table.rows.push({
        fare_id: fareId,
        route_id: "",
        origin_id: "",
        destination_id: "",
        contains_id: "",
      });
    });
  };

  const deleteRule = (index: number) => {
    mutateFeed((f) => {
      const table = getTable(f, "fare_rules");
      if (!table) return;
      table.rows.splice(index, 1);
    });
  };

  const editAttribution = (index: number, field: string, value: string) => {
    mutateFeed((f) => {
      const row = getRows(f, "attributions")[index];
      if (row) row[field] = value;
    });
  };

  const addAttribution = () => {
    mutateFeed((f) => {
      const table = ensureTable(f, "attributions", ATTRIBUTION_COLUMNS);
      const id = nextId(table.rows, "attribution_id", "attr");
      table.rows.push({
        attribution_id: id,
        organization_name: getRows(f, "agency")[0]?.["agency_name"] ?? "データ提供者",
        is_producer: "1",
        is_operator: "",
        is_authority: "",
        attribution_url: getRows(f, "agency")[0]?.["agency_url"] ?? "",
        attribution_email: "",
        attribution_phone: "",
      });
    });
  };

  const deleteAttribution = (index: number) => {
    mutateFeed((f) => {
      const table = getTable(f, "attributions");
      if (!table) return;
      table.rows.splice(index, 1);
    });
  };

  return (
    <div className="fares-view">
      <section className="fare-section">
        <div className="section-toolbar">
          <h3>運賃</h3>
          <button type="button" onClick={addFare}>
            運賃追加
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>fare_id</th>
                <th>価格</th>
                <th>通貨</th>
                <th>支払</th>
                <th>乗継</th>
                <th>agency_id</th>
                <th>IC価格</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {fares.map((fare) => {
                const id = fare["fare_id"] ?? "";
                return (
                  <tr key={id}>
                    <td className="mono">{id}</td>
                    <td>
                      <input className="fare-price" value={fare["price"] ?? ""} onChange={(e) => editFare(id, "price", e.target.value)} />
                    </td>
                    <td>
                      <input className="fare-short" value={fare["currency_type"] ?? ""} onChange={(e) => editFare(id, "currency_type", e.target.value)} />
                    </td>
                    <td>
                      <select value={fare["payment_method"] ?? ""} onChange={(e) => editFare(id, "payment_method", e.target.value)}>
                        <option value="0">乗車時</option>
                        <option value="1">事前</option>
                      </select>
                    </td>
                    <td>
                      <select value={fare["transfers"] ?? ""} onChange={(e) => editFare(id, "transfers", e.target.value)}>
                        <option value="">無制限/未指定</option>
                        <option value="0">不可</option>
                        <option value="1">1回</option>
                        <option value="2">2回</option>
                      </select>
                    </td>
                    <td>
                      <input className="fare-id-input" value={fare["agency_id"] ?? ""} onChange={(e) => editFare(id, "agency_id", e.target.value)} />
                    </td>
                    <td>
                      <input className="fare-price" value={fare["ic_price"] ?? ""} onChange={(e) => editFare(id, "ic_price", e.target.value)} />
                    </td>
                    <td>
                      <button type="button" className="danger" onClick={() => deleteFare(id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {fares.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    fare_attributes.txt がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fare-section">
        <div className="section-toolbar">
          <h3>適用条件</h3>
          <button type="button" onClick={() => addRule()}>
            条件追加
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>fare_id</th>
                <th>route_id</th>
                <th>origin_id</th>
                <th>destination_id</th>
                <th>contains_id</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={index}>
                  <td>
                    <select value={rule["fare_id"] ?? ""} onChange={(e) => editRule(index, "fare_id", e.target.value)}>
                      <option value=""></option>
                      {fares.map((fare) => (
                        <option key={fare["fare_id"] ?? ""} value={fare["fare_id"] ?? ""}>
                          {fare["fare_id"] ?? ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={rule["route_id"] ?? ""} onChange={(e) => editRule(index, "route_id", e.target.value)}>
                      <option value=""></option>
                      {routes.map((route) => (
                        <option key={route.routeId} value={route.routeId}>
                          {route.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <ZoneInput value={rule["origin_id"] ?? ""} zones={zones} onChange={(value) => editRule(index, "origin_id", value)} />
                  </td>
                  <td>
                    <ZoneInput value={rule["destination_id"] ?? ""} zones={zones} onChange={(value) => editRule(index, "destination_id", value)} />
                  </td>
                  <td>
                    <ZoneInput value={rule["contains_id"] ?? ""} zones={zones} onChange={(value) => editRule(index, "contains_id", value)} />
                  </td>
                  <td>
                    <button type="button" className="danger" onClick={() => deleteRule(index)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    均一運賃の場合、fare_rules.txt は空でも構いません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fare-section">
        <div className="section-toolbar">
          <h3>帰属表示</h3>
          <button type="button" onClick={addAttribution}>
            帰属追加
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>attribution_id</th>
                <th>組織名</th>
                <th>作成</th>
                <th>運行</th>
                <th>管轄</th>
                <th>URL</th>
                <th>メール</th>
                <th>電話</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {attributions.map((row, index) => (
                <tr key={`${row["attribution_id"] ?? ""}-${index}`}>
                  <td>
                    <input
                      className="fare-id-input"
                      value={row["attribution_id"] ?? ""}
                      onChange={(e) => editAttribution(index, "attribution_id", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="attribution-name-input"
                      value={row["organization_name"] ?? ""}
                      onChange={(e) => editAttribution(index, "organization_name", e.target.value)}
                    />
                  </td>
                  {(["is_producer", "is_operator", "is_authority"] as const).map((field) => (
                    <td key={field} className="check-cell">
                      <input
                        type="checkbox"
                        checked={(row[field] ?? "") === "1"}
                        onChange={(e) => editAttribution(index, field, e.target.checked ? "1" : "")}
                      />
                    </td>
                  ))}
                  <td>
                    <input value={row["attribution_url"] ?? ""} onChange={(e) => editAttribution(index, "attribution_url", e.target.value)} />
                  </td>
                  <td>
                    <input value={row["attribution_email"] ?? ""} onChange={(e) => editAttribution(index, "attribution_email", e.target.value)} />
                  </td>
                  <td>
                    <input value={row["attribution_phone"] ?? ""} onChange={(e) => editAttribution(index, "attribution_phone", e.target.value)} />
                  </td>
                  <td>
                    <button type="button" className="danger" onClick={() => deleteAttribution(index)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              {attributions.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    attributions.txt がありません。GTFS-JP v4ではデータ提供者・運行者・管轄者の明示を推奨します。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ZoneInput({ value, zones, onChange }: { value: string; zones: string[]; onChange: (value: string) => void }) {
  if (zones.length === 0) {
    return <input className="fare-id-input" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value=""></option>
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
