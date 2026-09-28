import { requireUser } from "@/lib/auth";
import { getCxBrand } from "@/lib/cx/context";

/** For server actions / route handlers: signed-in owner or member of the brand (throws 401/403/404). */
export async function brandUser(brandId: string, opts: { write?: boolean } = { write: true }) {
  const user = await requireUser();
  const project = await getCxBrand(user.id, brandId, opts);
  return { user: { id: user.id, name: user.name || user.email, email: user.email }, project };
}
