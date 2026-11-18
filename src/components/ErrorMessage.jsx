import { AlertCircle } from "lucide-react";

export default function ErrorMessage({ message }) {
  return (
    <p className="error">
      <AlertCircle size={16} aria-hidden="true" /> <span>{message}</span>
    </p>
  );
}
