# Hệ plugin — ERP Framework

Framework mở rộng được mà **không sửa lõi** qua Plugin SDK. Một plugin
khai báo một `PluginModule` và tự đăng ký vào `pluginRegistry`.

## 5 loại plugin

| `kind`          | Mở rộng                                   |
|-----------------|-------------------------------------------|
| `field-type`    | Kiểu field mới trong EntityDesigner       |
| `workflow-node` | Loại node mới trong WorkflowDesigner      |
| `page-widget`   | Widget mới cho PageDesigner               |
| `mcp-connector` | Nguồn MCP tuỳ biến                        |
| `llm-adapter`   | Nhà cung cấp LLM tuỳ biến                 |

Hợp đồng (interface) nằm ở `@erp-framework/core` —
`packages/core/src/plugin/types.ts`.

## Tạo plugin

```sh
pnpm new:plugin mau-sac
```

Lệnh sinh `src/plugins/mau-sac.ts` từ khuôn mẫu. Mở file, sửa mảng
`plugins`. Ví dụ một field-type:

```ts
import { pluginRegistry, type PluginModule } from "@erp-framework/core";

const mod: PluginModule = {
  name: "mau-sac",
  apiVersion: "0.1.0",
  plugins: [
    {
      kind: "field-type",
      type: "color",
      label: "Màu sắc",
      icon: "Tag",
      description: "Chọn mã màu hex",
      coerce: (raw) => ({ value: String(raw) }),
    },
  ],
};

pluginRegistry.register(mod);
```

## Loader

`src/plugins/index.ts` tự quét và nạp **mọi** file `.ts` trong
`src/plugins/`. Thả file vào là xong — không cần sửa `main.tsx`.
Xem `src/plugins/example.ts` để có mẫu đầy đủ (field-type + workflow-node).

## Tương thích phiên bản

`apiVersion` của plugin được kiểm semver với `CURRENT_API_VERSION` của
framework. Framework 0.x: khớp cả major lẫn minor. Không khớp →
`register()` ném lỗi.

## Giới hạn hiện tại

Plugin đăng ký ở tầng app (trình duyệt). Để **workflow-runner phía
server** thực thi node do plugin định nghĩa, cần nạp plugin cả phía
backend — đây là bước kiến trúc riêng chưa làm. Hiện node plugin
thiết kế / kéo-thả được, nhưng runner builtin chưa execute node lạ.
