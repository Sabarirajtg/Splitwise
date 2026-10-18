import "../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import ToastHost from "../components/ToastHost";

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
      <ToastHost />
    </SessionProvider>
  );
}
