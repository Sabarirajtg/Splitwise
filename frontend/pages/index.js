import { useEffect } from "react";
import { useRouter } from "next/router";
import { getSession } from "../lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const session = getSession();
    router.replace(session ? "/groups" : "/login");
  }, []);
  return null;
}
