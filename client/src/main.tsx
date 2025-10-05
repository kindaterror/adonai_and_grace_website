
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Slight defer to allow critical CSS & fonts to settle before heavy JS
const start = () => {
	const el = document.getElementById("root");
	if (el) createRoot(el).render(<App />);
};

if ("requestIdleCallback" in window) {
	(window as any).requestIdleCallback(start, { timeout: 150 });
} else {
	setTimeout(start, 40); // small delay fallback
}
