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
  /** Tên field lookup trên node "from" chứa recordId đích. */
  fromField: string;
  /** Entity mà field lookup trỏ tới. */
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
}

export interface DataSourceConfig {
  baseEntityId: string;
  relations: DataSourceRelation[];
  /** Projection. Rỗng = tự chiếu field của base. */
  fields: DataSourceField[];
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
}

/** 1 row phẳng kết quả. `id` = base record id (gốc ghi); `__ids` ánh xạ
 *  relationId → recordId đích (để ghi ngược đúng record join). */
export interface DataSourceRow {
  id: string;
  __ids?: Record<string, string | null>;
  [key: string]: unknown;
}
