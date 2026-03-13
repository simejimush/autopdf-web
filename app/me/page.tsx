import { redirect } from "next/navigation";

export default function MeRedirectPage() {
  redirect("/settings");
}
