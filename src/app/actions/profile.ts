// autopdf-web/src/app/actions/profile.ts
"use server";

import { revalidatePath } from "next/cache";
import {
  getOrCreateMyProfile,
  updateMyProfile,
} from "@/lib/profile/profile.server";

export async function getMyProfileAction() {
  return await getOrCreateMyProfile();
}

export async function updateMyProfileAction(formData: FormData): Promise<void> {
  const display_name = (formData.get("display_name") as string | null) ?? null;
  const company_name = (formData.get("company_name") as string | null) ?? null;

  const normalize = (v: string | null) => {
    if (v == null) return null;
    const t = v.trim();
    return t.length ? t : null;
  };

  await updateMyProfile({
    display_name: normalize(display_name),
    company_name: normalize(company_name),
  });

  // 右上の表示を更新したいので layout をrevalidate
  revalidatePath("/", "layout");
}
