import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: { prompt: "select_account", access_type: "offline", response_type: "code" } },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 }, // 30 dagen
  callbacks: {
    async signIn({ profile }) {
      const email = String(profile?.email || "").toLowerCase();
      const allowed = (process.env.ALLOW_DOMAINS || "huidpraktijkshop.nl")
        .split(",")
        .map(d => d.trim().toLowerCase())
        .filter(Boolean);
      return allowed.some(d => email.endsWith("@" + d));
    },
    async session({ session, token }) {
      if (token?.email) session.user = { ...(session.user || {}), email: String(token.email) };
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
};
export default NextAuth(authOptions);
