// Single source of truth for the dummy e-commerce stores' seeded demo
// accounts and the "link an account" request — shared by EcommerceAccountLink
// (the full dialog) and OnboardingTour (the one-click shortcut in the setup
// wizard), so the two can't drift apart the way the separate copies used to.
// Mirrors backend/ecommerce_sources.py — keep in sync when a store is added
// or removed there.

export const ECOMMERCE_STORES = [
  { key: "oren", label: "Toko Oren" },
  { key: "hijau", label: "Toko Hijau" },
] as const;

export const DEMO_ACCOUNTS: Record<string, { username: string; password: string }> = {
  oren: { username: "admin", password: "admin123" },
  hijau: { username: "demo", password: "demo123" },
};

export type LinkEcommerceResult = { success: true } | { success: false; error: string };

export async function linkEcommerceAccount(
  serverUrl: string | undefined,
  token: string,
  source: string,
  username: string,
  password: string,
): Promise<LinkEcommerceResult> {
  try {
    const res = await fetch(`${serverUrl}/ecommerce-account`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: username.trim(), password, source }),
    });
    const data = await res.json();
    if (res.ok && data.status === "OK") {
      return { success: true };
    }
    return { success: false, error: data.detail || "Gagal menyimpan akun" };
  } catch (err) {
    console.error("Link ecommerce account error:", err);
    return { success: false, error: "Terjadi kesalahan, coba lagi." };
  }
}
