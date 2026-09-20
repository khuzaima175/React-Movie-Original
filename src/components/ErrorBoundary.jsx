import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";

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
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-bg text-text-1 text-center">
          <div className="w-full max-w-lg rounded-modal border border-hairline bg-surface-1 p-8 shadow-sh-3 space-y-5">
            <div className="w-12 h-12 mx-auto rounded-full bg-danger/10 border border-danger/20 flex items-center justify-center text-danger">
              <AlertTriangle size={24} aria-hidden="true" />
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-text-1">
                Something unexpected happened
              </h2>
              <p className="text-xs sm:text-sm text-text-3 mt-2 leading-relaxed">
                {this.state.error?.toString() || "A component render error occurred in the vault interface."}
              </p>
            </div>

            <div className="pt-2 flex justify-center">
              <Button
                variant="secondary"
                size="md"
                onClick={this.handleReload}
                icon={RefreshCw}
              >
                Reload Vault
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
