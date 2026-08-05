import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container" style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#090C12",
          color: "#ffffff",
          fontFamily: "sans-serif",
          padding: "2rem",
          textAlign: "center"
        }}>
          <div style={{
            background: "#131926",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "1rem",
            padding: "3rem",
            maxWidth: "50rem",
            boxShadow: "0 20px 50px rgba(0,0,0,0.8)"
          }}>
            <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: "1.5rem" }} />
            <h2 style={{ fontSize: "2.2rem", fontWeight: "700", marginBottom: "1rem" }}>
              Something unexpected happened
            </h2>
            <p style={{ fontSize: "1.4rem", color: "#cbd5e1", marginBottom: "2rem" }}>
              {this.state.error?.toString() || "A component render error occurred."}
            </p>
            <button
              onClick={this.handleReload}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.8rem",
                backgroundColor: "#0284c7",
                color: "#ffffff",
                border: "none",
                padding: "1rem 2rem",
                borderRadius: "0.6rem",
                fontSize: "1.4rem",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              <RefreshCw size={16} /> Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
