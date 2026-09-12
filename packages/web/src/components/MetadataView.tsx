import { getTable, setTable, type Feed } from "@gtfs-studio/core";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  wide?: boolean;
  type?: "email" | "url";
}

const AGENCY_FIELDS: Field[] = [
  { key: "agency_name", label: "事業者名", placeholder: "○○交通" },
  { key: "agency_url", label: "事業者URL", placeholder: "https://example.jp", type: "url", wide: true },
  { key: "agency_timezone", label: "タイムゾーン", placeholder: "Asia/Tokyo" },
  { key: "agency_lang", label: "言語", placeholder: "ja" },
  { key: "agency_phone", label: "電話番号", placeholder: "03-0000-0000" },
  { key: "agency_email", label: "メール", placeholder: "info@example.jp", type: "email" },
];

const FEED_FIELDS: Field[] = [
  { key: "feed_publisher_name", label: "公開者名", placeholder: "○○交通" },
  { key: "feed_publisher_url", label: "公開者URL", placeholder: "https://example.jp", type: "url", wide: true },
  { key: "feed_lang", label: "言語", placeholder: "ja" },
  { key: "feed_version", label: "バージョン", placeholder: "2026-09-12" },
  { key: "feed_start_date", label: "開始日", placeholder: "YYYYMMDD" },
  { key: "feed_end_date", label: "終了日", placeholder: "YYYYMMDD" },
  { key: "feed_contact_email", label: "連絡先メール", placeholder: "gtfs@example.jp", type: "email" },
  { key: "feed_contact_url", label: "連絡先URL", placeholder: "https://example.jp/contact", type: "url", wide: true },
];

export function updateFirstRow(feed: Feed, tableName: string, key: string, value: string) {
  const table = getTable(feed, tableName);
  if (!table) {
    setTable(feed, tableName, [{ [key]: value }], [key]);
    return;
  }
  if (!table.columns.includes(key)) table.columns.push(key);
  if (table.rows.length === 0) table.rows.push({});
  table.rows[0]![key] = value;
}

export function MetadataView({ feed, version: _version, mutateFeed }: Props) {
  const renderSection = (title: string, tableName: string, fields: Field[]) => {
    const row = getTable(feed, tableName)?.rows[0] ?? {};
    return (
      <section className="metadata-section">
        <h2>{title}</h2>
        <div className="form-grid">
          {fields.map((field) => (
            <label key={field.key} className={field.wide ? "wide" : undefined}>
              {field.label}
              <input
                type={field.type ?? "text"}
                value={row[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) =>
                  mutateFeed((current) => updateFirstRow(current, tableName, field.key, event.target.value))
                }
              />
            </label>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="metadata-view">
      <p className="metadata-help">公開者や連絡先、配信期間を編集できます。変更内容は入力のたびに再検証されます。</p>
      {renderSection("事業者（agency.txt）", "agency", AGENCY_FIELDS)}
      {renderSection("配信情報（feed_info.txt）", "feed_info", FEED_FIELDS)}
    </div>
  );
}
