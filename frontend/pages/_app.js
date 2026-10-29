import { useEffect, useState } from "react";
import Head from "next/head";
import "../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import ToastHost from "../components/ToastHost";

function ThemeToggle() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("splitshare_theme");
    const initial = saved === "light" || saved === "dark" ? saved : "dark";
    document.documentElement.dataset.theme = initial;
    setTheme(initial);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("splitshare_theme", next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("SplitShare service worker registration failed:", error);
    });
  }, []);

  return (
    <>
      <Head>
        <title>SplitShare</title>
        <meta name="theme-color" content="#8B5CF6" />
        <meta name="description" content="Split group expenses, track balances, and settle up with SplitShare." />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      <SessionProvider session={session}>
      <ThemeToggle />
      <Component {...pageProps} />
      <ToastHost />
      </SessionProvider>
    </>
  );
}
