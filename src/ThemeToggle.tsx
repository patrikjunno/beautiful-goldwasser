import { useEffect, useState } from "react";

type Mode = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Mode>("light");

  useEffect(() => {
    // 1) ta ev. sparat tema
    const saved = (localStorage.getItem("gw-theme") as Mode | null);
    // 2) kolla om html redan har ett tema (om du satt det någon annanstans)
    const htmlAttr = document.documentElement.getAttribute("data-theme") as Mode | null;
    // 3) fallback till systempreferens
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const initial: Mode = saved ?? htmlAttr ?? (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", initial);
    setTheme(initial);
  }, []);

  const toggle = () => {
    const next: Mode = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("gw-theme", next);
    setTheme(next);
  };

  return (
    <button className="btn" onClick={toggle} title="Byt tema">
      {theme === "light" ? "🌙 Mörkt läge" : "☀️ Ljust läge"}
    </button>
  );
}
