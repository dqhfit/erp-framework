/// <reference types="vite/client" />

// Hook tuỳ chọn do inline script (nếu có) gắn lên window để đổi favicon
// theo loại trang. Không bắt buộc tồn tại — useDocumentTitle guard trước khi gọi.
declare global {
  interface Window {
    updateFavicon?: (kind: "edit" | "portal" | "default") => void;
  }
}

export {};
