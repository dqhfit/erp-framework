/* ==========================================================
   ErrorBoundary — Chặn white-screen khi 1 component crash.
   Hiển thị màn hình lỗi + nút tải lại thay vì trang trắng.
   ========================================================== */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log để debug; production có thể gửi tới service giám sát
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#0b0b12",
          color: "#e7e7ee",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Ứng dụng gặp lỗi / Something went wrong
          </h1>
          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
            Một thành phần bị lỗi khi hiển thị. Thử tải lại trang.
          </p>
          <pre
            style={{
              fontSize: 11,
              textAlign: "left",
              background: "#16161f",
              border: "1px solid #2a2a38",
              borderRadius: 8,
              padding: 12,
              overflow: "auto",
              maxHeight: 200,
              marginBottom: 16,
            }}
          >
            {error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              background: "#7c5cff",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Tải lại trang / Reload
          </button>
        </div>
      </div>
    );
  }
}
