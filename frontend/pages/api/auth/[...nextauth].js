import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
  ],
  callbacks: {
    // Runs server-side after Google confirms the sign-in. We upsert the user
    // in our own MongoDB via the backend, and stash the resulting app user id
    // in the JWT so the client can read it from the session.
    async jwt({ token, account, profile }) {
      if (account && profile) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/google`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": process.env.INTERNAL_API_SECRET
            },
            body: JSON.stringify({
              googleId: profile.sub,
              email: profile.email,
              name: profile.name,
              avatarUrl: profile.picture
            })
          });
          const appUser = await res.json();
          if (res.ok) {
            token.appUserId = appUser.id;
            token.appUserName = appUser.name;
            token.appUserAvatar = appUser.avatarUrl;
          } else {
            token.appError = appUser.error || "Failed to sync account";
          }
        } catch (e) {
          token.appError = "Could not reach the server";
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.appUserId = token.appUserId || null;
      session.appUserName = token.appUserName || null;
      session.appUserAvatar = token.appUserAvatar || null;
      session.appError = token.appError || null;
      return session;
    }
  },
  pages: {
    signIn: "/login"
  }
};

export default NextAuth(authOptions);
