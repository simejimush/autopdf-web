"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      duration={3000}
      toastOptions={{
        style: {
          fontSize: "14px",
        },
      }}
    />
  );
}
