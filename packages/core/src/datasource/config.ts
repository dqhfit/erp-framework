/* ==========================================================
   config.ts — Cấu hình "Nguồn dữ liệu" (DataSource): gộp field
   từ nhiều entity liên quan (join qua lookup) thành 1 bảng phẳng,
   đọc + ghi được, gán cho widget. Lưu ở datasources.config (jsonb).

   Mô hình quan hệ là CÂY gốc base entity:
   - base = entity gốc (ghi được, aggregate-root).
   - mỗi relation = 1 hop many-to-one qua field lookup → target entity.
     relation.fromRelationId = null nghĩa là hop xuất phát từ base;
     khác null = hop lồng từ 1 relation trước (nested).
   - fields[] là các cột chiếu phẳng (projection), mỗi cột trỏ về
     1 node (base hoặc relationId) + tên field gốc trên node đó.
   ========================================================== */

import type { FilterOp } from "./index";

export type JoinKind = "left" | "inner";

/** Một hop many-to-one: field lookup trên node "from" → entity đích. */
export interface DataSourceRelation {
  /** Id ổn định, được fields[].sourceRelationId tham chiếu. */
  id: string;
  /** Nhãn người dùng, vd "khach_hang". */
  alias: string;
  /** null = hop từ base; khác null = id relation cha (nested). */
  fromRelationId: string | null;
  /** Tên field trên node "from" chứa GIÁ TRỊ khoá nối. Với lookup là
   *  recordId đích; với join cột-tự-do là giá trị bất kỳ khớp `toField`. */
  fromField: string;
  /** Tên cột trên entity đích để khớp với giá trị `fromField`.
   *  Bỏ trống hoặc "id" = khớp theo record id đích (lookup cổ điển,
   *  tương thích ngược). Khác = join cột↔cột (vd order.ma_kh = kh.ma).
   *  Lưu ý: cột nối phải là plaintext (KHÔNG encrypted) ở cả 2 phía vì
   *  so khớp ở tầng SQL; nhiều record đích khớp → lấy record đầu tiên
   *  (giả định many-to-one, giữ model bảng phẳng + ghi ngược aggregate). */
  toField?: string;
  /** Entity mà quan hệ trỏ tới. */
  targetEntityId: string;
  /** "left" (mặc định) giữ row base dù thiếu record liên quan; "inner" loại bỏ. */
  joinKind: JoinKind;
}

/** Một cột chiếu phẳng của row joined. */
export interface DataSourceField {
  /** Khóa phẳng duy nhất widget nhìn thấy, vd "khach_hang_ten". */
  key: string;
  /** Node nguồn: "base" hoặc id của 1 relation. */
  sourceRelationId: string | "base";
  /** Tên field gốc trên entity của node nguồn. */
  sourceField: string;
  label: string;
  /** FieldType copy từ EntityFieldDef nguồn (cho UI/format). */
  type: string;
  /** Cho ghi ngược. Mặc định: field base = true, field join = false. */
  writable?: boolean;
  /** Entity đích nếu field này là khóa tham chiếu (lookup): suy từ relation có
   *  fromField === sourceField → cho UI dựng lookup chọn bản ghi entity đó. */
  ref?: string;
  /** Lookup theo GIÁ TRỊ (không phải id): field trên entity `ref` dùng làm
   *  value lưu xuống (vd nguyên liệu lưu TÊN "CAO SU" chứ không phải UUID).
   *  Có set → picker chọn bản ghi master nhưng lưu/khớp theo field này. */
  refValueField?: string;
  /** NHẬT KÝ (snapshot): field BASE này tự điền + LƯU từ 1 cột projection của
   *  ref khi đổi mã ref. Giá trị = `key` của cột projection (vd "material_tenvt").
   *  Đóng băng giá trị tại thời điểm chọn — KHÁC cột join (đổi theo ref về sau).
   *  Chỉ áp cho field writable thuộc base; bỏ trống = không snapshot. */
  snapshotFrom?: string;
}

/** Hàm gom cho aggregate quan hệ 1-N / N-N. */
export type AggFn = "count" | "sum" | "avg" | "min" | "max";

/** Cột aggregate: gom giá trị từ NHIỀU record con (1-N reverse FK) hoặc qua
 *  bảng nối (N-N). Read-only (không ghi ngược). Tính ở tầng app (batch, không
 *  N+1). Khác với relation (many-to-one, 1 record): aggregate là many-to-MANY
 *  rút về 1 số.
 *
 *  1-N (reverse FK): với mỗi node nguồn, tìm record `targetEntity` có
 *  `targetField == matchValue` (matchValue lấy từ node nguồn theo `matchField`,
 *  mặc định record id) → gom `valueField` bằng `agg`.
 *
 *  N-N (qua bảng nối): `targetEntity` = bảng nối; `targetField` khớp node nguồn;
 *  `via.farField` trên bảng nối trỏ tới record thật ở `via.farEntityId` (khớp
 *  `via.farKeyField`, mặc định id) — `valueField` đọc trên record far đó.
 *  count = đếm số dòng bảng nối (số liên kết). */
export interface DataSourceAggregate {
  /** Khoá phẳng widget thấy. */
  key: string;
  label: string;
  agg: AggFn;
  /** Node cung cấp giá trị khớp: "base" hoặc id relation. Mặc định "base". */
  sourceRelationId?: string | "base";
  /** Field trên node nguồn giữ giá trị khớp. Mặc định "id" (record id). */
  matchField?: string;
  /** Entity "nhiều": bảng con (1-N) hoặc bảng nối (N-N). */
  targetEntityId: string;
  /** Field FK trên target khớp với giá trị `matchField` của node nguồn. */
  targetField: string;
  /** Field giá trị để gom (sum/avg/min/max). count KHÔNG cần. */
  valueField?: string;
  /** N-N qua bảng nối — bỏ trống = 1-N trực tiếp. */
  via?: {
    /** Entity thật chứa `valueField` (đầu xa của bảng nối). */
    farEntityId: string;
    /** Field trên bảng nối trỏ tới record far. */
    farField: string;
    /** Field id trên far để khớp `farField`. Mặc định "id". */
    farKeyField?: string;
  };
}

/** Cột TÍNH TOÁN (read-only): biểu thức formula trên các cột phẳng khác.
 *  Eval ở tầng app SAU stitch + aggregate, theo thứ tự mảng (cột sau tham
 *  chiếu được cột trước). Cú pháp = formula engine (`{key}` ref cột phẳng,
 *  + hàm IF/CONCAT/ROUND/SUM…). Fail-safe: lỗi eval → null, KHÔNG vỡ row. */
export interface DataSourceComputed {
  /** Khoá phẳng widget thấy. */
  key: string;
  label: string;
  /** Biểu thức: `{key}` tham chiếu cột phẳng (projection/aggregate/computed trước). */
  expr: string;
  /** Kiểu hiển thị gợi ý (number/text/date…). Mặc định "text". */
  type?: string;
}

export interface DataSourceConfig {
  baseEntityId: string;
  relations: DataSourceRelation[];
  /** Projection. Rỗng = tự chiếu field của base. */
  fields: DataSourceField[];
  /** Cột aggregate quan hệ 1-N / N-N (read-only). */
  aggregates?: DataSourceAggregate[];
  /** Cột tính toán (formula trên cột phẳng, read-only). */
  computed?: DataSourceComputed[];
  /** Lọc server-side, CHỈ trên field base (shape = QueryParams.filters). */
  baseFilters?: Record<string, { op: FilterOp; value: unknown }>;
  /** sort.key tham chiếu fields[].key. */
  sort?: { key: string; dir: "asc" | "desc" };
  defaultLimit?: number;
}

/** Descriptor server trả cho widget (tương đương entity.fields). */
export interface DataSourceMeta {
  id: string;
  name: string;
  label: string;
  baseEntityId: string;
  fields: DataSourceField[];
  /** Quan hệ join — để widget map field ref (fromField) → cột projection của
   *  relation đó (vd đổi mã vật tư → auto điền Tên vật tư client-side). */
  relations?: DataSourceRelation[];
}

/** 1 row phẳng kết quả. `id` = base record id (gốc ghi); `__ids` ánh xạ
 *  relationId → recordId đích (để ghi ngược đúng record join). */
export interface DataSourceRow {
  id: string;
  __ids?: Record<string, string | null>;
  [key: string]: unknown;
}
